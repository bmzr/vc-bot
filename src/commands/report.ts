import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { joinVoiceChannel, VoiceConnectionStatus } from '@discordjs/voice';
import { EndBehaviorType, VoiceReceiver } from '@discordjs/voice';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import * as prism from 'prism-media';

@ApplyOptions<Command.Options>({
	description: 'Report an offending user in voice chat'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addUserOption((option) => option.setName('user').setDescription('The user to report').setRequired(true))
		);
	}

	// TODO: add context menu availability

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return this.processReport(interaction);
	}

	private async processReport(interaction: Command.ChatInputCommandInteraction) {
		// if command user && reported user in the same vc
		const reportedUser = interaction.options.getUser('user', true);
		const guild = interaction.guild;
		if (!guild) throw new Error('Guild not found.');

		const commandMember = await guild.members.fetch(interaction.user.id);
		const reportedMember = await guild.members.fetch(reportedUser.id);

		console.debug(`Command user: ${commandMember.user.tag} (${commandMember.id}), voice channel: ${commandMember.voice.channelId}`);
		console.debug(`Reported user: ${reportedMember.user.tag} (${reportedMember.id}), voice channel: ${reportedMember.voice.channelId}`);
		if (
			!commandMember.voice.channel ||
			!reportedMember.voice.channel ||
			commandMember.voice.channelId !== reportedMember.voice.channelId
		) {
			await interaction.reply({
				content: 'Both you and the reported user must be in the same voice channel.',
				ephemeral: true
			});
			return;
		}
		await interaction.reply({ content: `Report received for ${reportedUser.tag}. Processing...`, ephemeral: true });
		// join vc, set up sink for reported user record for 60s
		const voiceChannel = commandMember.voice.channel;
		if (!voiceChannel) {
			await interaction.editReply({ content: 'Failed to join voice channel.' });
			return;
		}

		//const finished = promisify(pipeline);

		console.debug('Joining voice channel...');
		const connection = joinVoiceChannel({
			channelId: voiceChannel.id,
			guildId: voiceChannel.guild.id,
			adapterCreator: voiceChannel.guild.voiceAdapterCreator,
			selfDeaf: false,
			selfMute: false
		});

		connection.on(VoiceConnectionStatus.Ready, () => {
			console.debug('Voice connection established.');
		});
		const receiver: VoiceReceiver = connection.receiver;
		const userId = reportedMember.id;

		console.debug(`Subscribing to audio stream for user: ${userId}`);
		const opusStream = receiver.subscribe(userId, {
			end: {
				behavior: EndBehaviorType.AfterSilence,
				duration: 5000 // end after 5s of silence
			}
		});
		const pcmDecoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
		const outputPath = `./recordings/report-${userId}-${Date.now()}.pcm`;

		const outputStream = createWriteStream(outputPath);


		opusStream.on('error', (err) => {
			console.error('Audio stream error:', err);
		});
		opusStream.on('data', (chunk) => {
			console.debug(`Received ${chunk.length} bytes of audio data.`);
			console.debug('Wrote chunk to output stream.');
		});
		// outputStream.on('error', (err) => {
		// 	console.error('Output stream error:', err);
		// });
		opusStream.on('end', async () => {
			//outputStream.close();
			console.debug('Audio stream ended.');
			await interaction.editReply({ content: `Report processing complete for ${reportedUser.tag}.` });
			connection.destroy();
		});
		outputStream.on('finish', () => {
			console.debug('Output stream ENCODER!!! finished.');
		});

		try {
			console.debug('Starting pipeline...');
			await pipeline(opusStream, pcmDecoder, outputStream);
			console.debug('Pipeline succeeded. Transcoding to mp3...');
			const mp3Path = outputPath.replace('.pcm', '.mp3');
			this.convertPcmToMp3(outputPath, mp3Path);
			console.debug('Transcoding complete:', mp3Path);
		} catch (err) {
			console.error('Pipeline failed:', err);
		}
		//await finished(opusStream, outputStream);

		//connection.destroy();
		// notify command user of success/failure
		// transcribe, send raw audio and transcription to mod log channel
	}
	private convertPcmToMp3(pcmPath: string, mp3Path: string) {
		// spawn ffmpeg
		// terminal command: ffmpeg -f s16le -ar 48000 -ac 2 -i input.pcm output.mp3
		const ffmpeg = spawn('ffmpeg', ['-f', 's16le', '-ar', '48000', '-ac', '2', '-i', pcmPath, mp3Path]);
		ffmpeg.on('error', (err) => {
			console.error('FFmpeg error:', err);
		});
		ffmpeg.on('close', (code) => {
			if (code === 0) {
				console.debug('FFmpeg process completed successfully.');
			} else {
				console.error(`FFmpeg process exited with code ${code}`);
			}
		});
	}
}
