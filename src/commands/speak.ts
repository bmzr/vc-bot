import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';

@ApplyOptions<Command.Options>({
	description: 'Speak as the bot'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) => option.setName('message').setDescription('The message for the bot to speak').setRequired(true))
				.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		);
	}

	// slash command
	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const message = interaction.options.getString('message', true).trim();
		if (message === null) {
			await interaction.reply({ content: 'No message provided. Please provide a message to speak.', ephemeral: true });
			return;
		}
		if (message.length === 0) {
			await interaction.reply({ content: 'Message is too short. Please provide a message to speak.', ephemeral: true });
			return;
		}
		if (message.length > 2000) {
			await interaction.reply({ content: 'Message is too long. Please keep it under 2000 characters.', ephemeral: true });
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const channel = interaction.channel;

		if (channel && 'send' in channel && typeof channel.send === 'function') {
			await channel.send(message);
			await interaction.editReply({ content: 'Message sent!' });
		} else {
			await interaction.editReply({ content: 'Failed to send message.' });
			this.container.logger.warn('Failed to send message', message, ': No suitable channel found for interaction.');
		}
	}
}
