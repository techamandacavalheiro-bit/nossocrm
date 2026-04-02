import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Board, BoardStage } from '@/types';
import { boardsService } from '@/lib/supabase';
import { useAuth } from '../AuthContext';
import { useToast } from '../ToastContext';
import { queryKeys } from '@/lib/query';
import { useBoards as useTanStackBoards } from '@/lib/query/hooks/useBoardsQuery';
import { useRouteNeeds } from '@/lib/hooks/useRouteNeeds';
import { isValidUUID } from '@/lib/supabase/utils';

interface BoardsContextType {
  boards: Board[];
  loading: boolean;
  error: string | null;
  addBoard: (board: Omit<Board, 'id' | 'createdAt'>, order?: number) => Promise<Board | null>;
  updateBoard: (id: string, updates: Partial<Board>) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;

  // Active board state (UI state - permanece em useState)
  activeBoardId: string;
  setActiveBoardId: (id: string) => void;
  activeBoard: Board | null;

  // Helpers
  getDefaultBoard: () => Board | null;
  getBoardById: (id: string) => Board | undefined;

  // Stages
  addStage: (boardId: string, stage: Omit<BoardStage, 'id'>) => Promise<BoardStage | null>;
  updateStage: (stageId: string, updates: Partial<BoardStage>) => Promise<void>;
  deleteStage: (stageId: string) => Promise<void>;

  // Refresh
  refresh: () => Promise<void>;
}

const BoardsContext = createContext<BoardsContextType | undefined>(undefined);

/**
 * Componente React `BoardsProvider`.
 *
 * @param {{ children: ReactNode; }} { children } - Parâmetro `{ children }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BoardsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const routeNeeds = useRouteNeeds();

  // ============================================
  // TanStack Query — lazy: só carrega se a rota precisa
  // ============================================
  const {
    data: boards = [],
    isLoading: loading,
    error: queryError,
  } = useTanStackBoards({ enabled: routeNeeds('boards') });

  // Converte erro do TanStack Query para string
  const error = queryError ? (queryError as Error).message : null;

  // ============================================
  // UI State - activeBoardId permanece em useState
  // ============================================
  const [activeBoardId, setActiveBoardIdRaw] = useState<string>('');

  // Wrapper que valida antes de setar
  const setActiveBoardId = useCallback((id: string) => {
    // Só seta se for um UUID válido que existe nos boards
    if (id && isValidUUID(id) && boards.some(b => b.id === id)) {
      setActiveBoardIdRaw(id);
    } else if (boards.length > 0) {
      // Fallback para primeiro board se ID inválido
      setActiveBoardIdRaw(boards[0].id);
    }
  }, [boards]);

  // Auto-seleciona primeiro board quando carrega ou quando activeBoardId é inválido
  useEffect(() => {
    if (boards.length > 0) {
      const currentBoardExists = boards.some(b => b.id === activeBoardId);
      if (!activeBoardId || !currentBoardExists) {
        const defaultBoard = boards.find(b => b.isDefault) || boards[0];
        setActiveBoardIdRaw(defaultBoard.id);
      }
    }
  }, [boards, activeBoardId]);

  // Refresh = invalidar cache do TanStack Query
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });
  }, [queryClient]);

  // ============================================
  // CRUD Operations - Usam service + invalidam cache
  // ============================================
  const addBoard = useCallback(
    async (board: Omit<Board, 'id' | 'createdAt'>, order?: number): Promise<Board | null> => {
      if (!profile) {
        console.error('Usuário não autenticado');
        return null;
      }

      const { data, error: addError } = await boardsService.create(board, order);

      if (addError) {
        console.error('Erro ao criar board:', addError.message);
        return null;
      }

      // Invalida cache para TanStack Query atualizar
      await queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });

      return data;
    },
    [profile?.organization_id, queryClient]
  );

  const updateBoard = useCallback(async (id: string, updates: Partial<Board>) => {
    const { error: updateError } = await boardsService.update(id, updates);

    if (updateError) {
      console.error('Erro ao atualizar board:', updateError.message);
      return;
    }

    // Invalida cache para TanStack Query atualizar
    await queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });
  }, [queryClient]);

  const deleteBoard = useCallback(async (id: string) => {
    const { error: deleteError } = await boardsService.delete(id);

    if (deleteError) {
      console.error('Erro ao deletar board:', deleteError.message);
      return;
    }

    // Invalida cache para TanStack Query atualizar
    await queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });
    // Também invalida deals pois referenciam boards
    await queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
  }, [queryClient]);

  // ============================================
  // Stage Operations
  // ============================================
  const addStage = useCallback(
    async (boardId: string, stage: Omit<BoardStage, 'id'>): Promise<BoardStage | null> => {
      const { data, error: addError } = await boardsService.addStage(boardId, stage);

      if (addError) {
        console.error('Erro ao criar stage:', addError.message);
        return null;
      }

      // Invalida cache para TanStack Query atualizar
      await queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });

      return data;
    },
    [queryClient]
  );

  const updateStage = useCallback(async (stageId: string, updates: Partial<BoardStage>) => {
    const { error: updateError } = await boardsService.updateStage(stageId, updates);

    if (updateError) {
      console.error('Erro ao atualizar stage:', updateError.message);
      return;
    }

    // Invalida cache para TanStack Query atualizar
    await queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });
  }, [queryClient]);

  const deleteStage = useCallback(async (stageId: string) => {
    const { error: deleteError } = await boardsService.deleteStage(stageId);

    if (deleteError) {
      console.error('Erro ao deletar stage:', deleteError.message);
      addToast(deleteError.message, 'error');
      return;
    }

    // Invalida cache para TanStack Query atualizar
    await queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });
  }, [queryClient, addToast]);

  // ============================================
  // Helpers (derivados do cache)
  // ============================================
  const getBoardById = useCallback(
    (id: string) => boards.find(b => b.id === id),
    [boards]
  );

  const getDefaultBoard = useCallback(() => {
    return boards.find(b => b.isDefault) || boards[0] || null;
  }, [boards]);

  const activeBoard = useMemo(() => {
    return getBoardById(activeBoardId) || getDefaultBoard();
  }, [activeBoardId, getBoardById, getDefaultBoard]);

  const value = useMemo(
    () => ({
      boards,
      loading,
      error,
      addBoard,
      updateBoard,
      deleteBoard,
      activeBoardId,
      setActiveBoardId,
      activeBoard,
      getDefaultBoard,
      getBoardById,
      addStage,
      updateStage,
      deleteStage,
      refresh,
    }),
    [
      boards,
      loading,
      error,
      addBoard,
      updateBoard,
      deleteBoard,
      activeBoardId,
      setActiveBoardId,
      activeBoard,
      getDefaultBoard,
      getBoardById,
      addStage,
      updateStage,
      deleteStage,
      refresh,
    ]
  );

  return <BoardsContext.Provider value={value}>{children}</BoardsContext.Provider>;
};

/**
 * Hook React `useBoards` que encapsula uma lógica reutilizável.
 * @returns {BoardsContextType} Retorna um valor do tipo `BoardsContextType`.
 */
export const useBoards = () => {
  const context = useContext(BoardsContext);
  if (context === undefined) {
    throw new Error('useBoards must be used within a BoardsProvider');
  }
  return context;
};
