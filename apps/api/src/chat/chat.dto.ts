import { chatMessagesResponseSchema, chatRequestSchema } from '@garfo/shared';
import { createZodDto } from 'nestjs-zod';

export class ChatRequestDto extends createZodDto(chatRequestSchema) {}
export class ChatMessagesResponseDto extends createZodDto(chatMessagesResponseSchema) {}
