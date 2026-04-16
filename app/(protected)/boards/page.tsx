import type { Metadata } from 'next';
import { BoardsPage } from '@/features/boards/BoardsPage'

export const metadata: Metadata = { title: 'Funis | Cavalheiro Experience' };

export default function Boards() {
    return <BoardsPage />
}
