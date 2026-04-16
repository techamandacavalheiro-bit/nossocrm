import type { Metadata } from 'next';
import DashboardPage from '@/features/dashboard/DashboardPage'

export const metadata: Metadata = { title: 'Dashboard | Cavalheiro Experience' };

export default function Dashboard() {
    return <DashboardPage />
}
