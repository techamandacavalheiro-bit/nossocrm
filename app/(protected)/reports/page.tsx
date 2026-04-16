import type { Metadata } from 'next';
import ReportsPage from '@/features/reports/ReportsPage'

export const metadata: Metadata = { title: 'Relatórios | Cavalheiro Experience' };

export default function Reports() {
    return <ReportsPage />
}
