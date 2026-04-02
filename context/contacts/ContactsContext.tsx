import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Contact, Company } from '@/types';
import { contactsService, companiesService } from '@/lib/supabase';
import { useAuth } from '../AuthContext';
import { queryKeys } from '@/lib/query';
import {
  useContacts as useTanStackContacts,
  useCompanies as useTanStackCompanies,
} from '@/lib/query/hooks/useContactsQuery';
import { useRouteNeeds } from '@/lib/hooks/useRouteNeeds';

interface ContactsContextType {
  // Contacts
  contacts: Contact[];
  contactsLoading: boolean;
  contactsError: string | null;
  addContact: (contact: Omit<Contact, 'id' | 'createdAt'>) => Promise<Contact | null>;
  updateContact: (id: string, updates: Partial<Contact>) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;

  // Companies
  companies: Company[];
  companiesLoading: boolean;
  companiesError: string | null;
  addCompany: (company: Omit<Company, 'id' | 'createdAt'>) => Promise<Company | null>;
  updateCompany: (id: string, updates: Partial<Company>) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;

  // Lookup maps (O(1) access)
  companyMap: Record<string, Company>;
  contactMap: Record<string, Contact>;

  // Derived data
  leadsFromContacts: Contact[];

  // Refresh
  refreshContacts: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
}

const ContactsContext = createContext<ContactsContextType | undefined>(undefined);

/**
 * Componente React `ContactsProvider`.
 *
 * @param {{ children: ReactNode; }} { children } - Parâmetro `{ children }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ContactsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const routeNeeds = useRouteNeeds();

  // ============================================
  // TanStack Query — lazy: só carrega se a rota precisa
  // ============================================
  const {
    data: contacts = [],
    isLoading: contactsLoading,
    error: contactsQueryError
  } = useTanStackContacts(undefined, { enabled: routeNeeds('contacts') });

  const {
    data: companies = [],
    isLoading: companiesLoading,
    error: companiesQueryError
  } = useTanStackCompanies({ enabled: routeNeeds('companies') });

  // Converte erros do TanStack Query para string
  const contactsError = contactsQueryError ? (contactsQueryError as Error).message : null;
  const companiesError = companiesQueryError ? (companiesQueryError as Error).message : null;

  // Refresh = invalidar cache do TanStack Query
  const refreshContacts = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
  }, [queryClient]);

  const refreshCompanies = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  }, [queryClient]);

  // ============================================
  // CRUD Operations - Usam service + invalidam cache
  // ============================================
  const addContact = useCallback(
    async (contact: Omit<Contact, 'id' | 'createdAt'>): Promise<Contact | null> => {
      if (!profile) {
        console.error('Usuário não autenticado');
        return null;
      }

      const { data, error } = await contactsService.create(contact);

      if (error) {
        console.error('Erro ao criar contato:', error.message);
        return null;
      }

      // Invalida cache para TanStack Query atualizar
      await queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });

      return data;
    },
    [profile, queryClient]
  );

  const updateContact = useCallback(async (id: string, updates: Partial<Contact>) => {
    const { error } = await contactsService.update(id, updates);

    if (error) {
      console.error('Erro ao atualizar contato:', error.message);
      return;
    }

    // Invalida cache para TanStack Query atualizar
    await queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
  }, [queryClient]);

  const deleteContact = useCallback(async (id: string) => {
    const { error } = await contactsService.delete(id);

    if (error) {
      console.error('Erro ao deletar contato:', error.message);
      return;
    }

    // Invalida cache para TanStack Query atualizar
    await queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
  }, [queryClient]);

  // Company CRUD
  const addCompany = useCallback(
    async (company: Omit<Company, 'id' | 'createdAt'>): Promise<Company | null> => {
      if (!profile) {
        console.error('Usuário não autenticado');
        return null;
      }

      const { data, error } = await companiesService.create(company);

      if (error) {
        console.error('Erro ao criar empresa:', error.message);
        return null;
      }

      // Invalida cache para TanStack Query atualizar
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });

      return data;
    },
    [profile, queryClient]
  );

  const updateCompany = useCallback(async (id: string, updates: Partial<Company>) => {
    const { error } = await companiesService.update(id, updates);

    if (error) {
      console.error('Erro ao atualizar empresa:', error.message);
      return;
    }

    // Invalida cache para TanStack Query atualizar
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  }, [queryClient]);

  const deleteCompany = useCallback(async (id: string) => {
    const { error } = await companiesService.delete(id);

    if (error) {
      console.error('Erro ao deletar empresa:', error.message);
      return;
    }

    // Invalida cache para TanStack Query atualizar
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  }, [queryClient]);

  // Hash Maps para O(1) lookups
  const companyMap = useMemo(() => {
    return companies.reduce(
      (acc, c) => {
        acc[c.id] = c;
        return acc;
      },
      {} as Record<string, Company>
    );
  }, [companies]);

  const contactMap = useMemo(() => {
    return contacts.reduce(
      (acc, c) => {
        acc[c.id] = c;
        return acc;
      },
      {} as Record<string, Contact>
    );
  }, [contacts]);

  // Contacts filtrados por stage = LEAD
  const leadsFromContacts = useMemo(() => {
    return contacts.filter(c => c.stage === 'LEAD');
  }, [contacts]);

  const value = useMemo(
    () => ({
      contacts,
      contactsLoading,
      contactsError,
      addContact,
      updateContact,
      deleteContact,
      companies,
      companiesLoading,
      companiesError,
      addCompany,
      updateCompany,
      deleteCompany,
      companyMap,
      contactMap,
      leadsFromContacts,
      refreshContacts,
      refreshCompanies,
    }),
    [
      contacts,
      contactsLoading,
      contactsError,
      addContact,
      updateContact,
      deleteContact,
      companies,
      companiesLoading,
      companiesError,
      addCompany,
      updateCompany,
      deleteCompany,
      companyMap,
      contactMap,
      leadsFromContacts,
      refreshContacts,
      refreshCompanies,
    ]
  );

  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
};

/**
 * Hook React `useContacts` que encapsula uma lógica reutilizável.
 * @returns {ContactsContextType} Retorna um valor do tipo `ContactsContextType`.
 */
export const useContacts = () => {
  const context = useContext(ContactsContext);
  if (context === undefined) {
    throw new Error('useContacts must be used within a ContactsProvider');
  }
  return context;
};
