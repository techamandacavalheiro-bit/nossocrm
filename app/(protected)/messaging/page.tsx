import type { Metadata } from 'next';
import { MessagingPage } from '@/features/messaging/MessagingPage'

export const metadata: Metadata = { title: 'Mensagens | Cavalheiro Experience' };

export default function Messaging() {
    return <MessagingPage />
}
