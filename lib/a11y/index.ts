/**
 * @fileoverview Biblioteca de acessibilidade para o Cavalheiro Experience.
 * 
 * Este módulo fornece componentes e hooks para implementar acessibilidade
 * seguindo as diretrizes WCAG 2.1 Level AA.
 * 
 * ## Componentes
 * 
 * - `FocusTrap` - Armadilha de foco para modais e diálogos
 * - `VisuallyHidden` - Conteúdo visível apenas para leitores de tela
 * - `SkipLink` - Link para pular navegação
 * - `LiveRegion` - Anúncios para leitores de tela
 * 
 * ## Hooks
 * 
 * - `useFocusReturn` - Retorna foco ao elemento anterior após fechar modal
 * - `useAnnounce` - Anuncia mensagens para leitores de tela
 * - `useKeyboardShortcut` - Gerencia atalhos de teclado
 * - `useFormErrorFocus` - Foca automaticamente no primeiro erro de formulário
 * 
 * @module lib/a11y
 * 
 * @example
 * ```tsx
 * import { FocusTrap, useFocusReturn } from '@/lib/a11y';
 * 
 * function Modal({ isOpen, onClose }) {
 *   useFocusReturn({ enabled: isOpen });
 *   
 *   return (
 *     <FocusTrap active={isOpen} onEscape={onClose}>
 *       <dialog role="dialog" aria-modal="true">
 *         ...
 *       </dialog>
 *     </FocusTrap>
 *   );
 * }
 * ```
 */

// Components
export { FocusTrap } from './components/FocusTrap';
export type { FocusTrapProps } from './components/FocusTrap';

export { VisuallyHidden } from './components/VisuallyHidden';
export type { VisuallyHiddenProps } from './components/VisuallyHidden';

export { SkipLink } from './components/SkipLink';
export type { SkipLinkProps } from './components/SkipLink';

export { LiveRegion } from './components/LiveRegion';
export type { LiveRegionProps } from './components/LiveRegion';

// Hooks
export { useFocusReturn } from './hooks/useFocusReturn';
export type { UseFocusReturnOptions } from './hooks/useFocusReturn';

export { useAnnounce } from './hooks/useAnnounce';
export type { UseAnnounceOptions } from './hooks/useAnnounce';

export { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
export type { KeyboardShortcut, UseKeyboardShortcutOptions } from './hooks/useKeyboardShortcut';

export { useFormErrorFocus } from './hooks/useFormErrorFocus';
