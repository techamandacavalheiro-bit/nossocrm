import type { Metadata } from 'next';
import { ProfilePage } from '@/features/profile/ProfilePage'

export const metadata: Metadata = { title: 'Perfil | Cavalheiro Experience' };

export default function Profile() {
    return <ProfilePage />
}
