'use client';

import React, { memo, useCallback, useEffect, useState } from 'react';
import { Sparkles, Brain, Shield, MessageCircle, X, Loader2, Copy, Check, ArrowRightCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCopilot, type CopilotAction } from '@/lib/query/hooks/useAiCopilot';

interface CopilotPanelProps {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  /** Quando o atendente escolhe uma sugestão, preenche o input. */
  onUseSuggestion?: (text: string) => void;
}

const TABS: Array<{
  key: CopilotAction;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
  needsInput?: boolean;
  cta: string;
}> = [
  { key: 'suggest', label: 'Sugerir', icon: Sparkles, hint: 'Gera 2-3 variações alinhadas ao script.', cta: 'Sugerir resposta' },
  { key: 'analyze', label: 'Analisar', icon: Brain, hint: 'Temperatura, objeções e próximo passo.', cta: 'Analisar' },
  { key: 'objection', label: 'Objeção', icon: Shield, hint: 'Cole a objeção e receba contornos.', cta: 'Objeção', needsInput: true },
  { key: 'ask', label: 'Perguntar', icon: MessageCircle, hint: 'Pergunta livre sobre o cliente.', cta: 'Perguntar', needsInput: true },
];

const PLACEHOLDERS: Record<CopilotAction, string> = {
  suggest: '',
  analyze: '',
  objection: 'Ex: "Tô achando caro, vou pensar..."',
  ask: 'Ex: "Como respondo se ele perguntar sobre parcelamento?"',
};

export const CopilotPanel = memo(function CopilotPanel({
  open,
  conversationId,
  onClose,
  onUseSuggestion,
}: CopilotPanelProps) {
  const [activeTab, setActiveTab] = useState<CopilotAction>('suggest');
  const [userInput, setUserInput] = useState('');
  const [result, setResult] = useState<{
    type: CopilotAction;
    text?: string;
    suggestions?: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copilot = useCopilot();

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset state when switching tabs
  const handleTabChange = useCallback((tab: CopilotAction) => {
    setActiveTab(tab);
    setResult(null);
    setErrorMsg(null);
    setUserInput('');
  }, []);

  const activeTabConfig = TABS.find(t => t.key === activeTab)!;
  const requiresInput = activeTabConfig.needsInput;
  const canRun = !requiresInput || userInput.trim().length > 0;

  const handleRun = useCallback(() => {
    setErrorMsg(null);
    setResult(null);
    copilot.mutate(
      {
        conversationId,
        action: activeTab,
        userInput: requiresInput ? userInput.trim() : undefined,
      },
      {
        onSuccess: (data) => {
          setResult({
            type: activeTab,
            text: data.text,
            suggestions: data.suggestions,
          });
        },
        onError: (err) => {
          setErrorMsg(err instanceof Error ? err.message : 'Erro ao executar');
        },
      }
    );
  }, [conversationId, activeTab, userInput, requiresInput, copilot]);

  const handleCopy = useCallback(async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch { /* noop */ }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Copiloto de Vendas"
    >
      <aside
        className={cn(
          'w-full max-w-md h-full bg-white dark:bg-slate-900',
          'border-l border-slate-200 dark:border-slate-700',
          'flex flex-col shadow-2xl',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white">Copiloto de Vendas</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-none">
                Sugestões inteligentes da IA
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors border-b-2',
                  isActive
                    ? 'border-purple-500 text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/20'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{activeTabConfig.hint}</p>

          {requiresInput && (
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder={PLACEHOLDERS[activeTab]}
              rows={3}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-lg resize-y min-h-[80px]',
                'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
                'text-slate-900 dark:text-slate-100',
                'focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500',
                'placeholder:text-slate-400',
              )}
            />
          )}

          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun || copilot.isPending}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all',
              !canRun || copilot.isPending
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-600/20',
            )}
          >
            {copilot.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
            {copilot.isPending ? 'Gerando...' : activeTabConfig.cta}
          </button>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-2">
              Sugestão
            </p>

            {errorMsg && (
              <div className="p-2.5 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-300">
                {errorMsg}
              </div>
            )}

            {!errorMsg && !result && !copilot.isPending && (
              <p className="text-sm text-slate-400 italic text-center py-6">
                Escolha uma ação acima
              </p>
            )}

            {!errorMsg && copilot.isPending && (
              <div className="flex items-center justify-center py-6 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}

            {!errorMsg && result && (
              <div className="space-y-2">
                {/* Free-form text (analyze, ask, objection.reframe) */}
                {result.text && (
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                      {result.text}
                    </p>
                  </div>
                )}

                {/* List of pickable suggestions */}
                {result.suggestions && result.suggestions.length > 0 && (
                  <div className="space-y-1.5">
                    {result.text && (
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mt-3 mb-1">
                        Respostas prontas
                      </p>
                    )}
                    {result.suggestions.map((s, i) => (
                      <div
                        key={i}
                        className="group rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-purple-300 dark:hover:border-purple-500/50 transition-colors overflow-hidden"
                      >
                        <p className="px-3 pt-2.5 pb-2 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                          {s}
                        </p>
                        <div className="flex items-center justify-end gap-1 px-2 pb-1.5 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-900/30">
                          <button
                            type="button"
                            onClick={() => handleCopy(s, i)}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded transition-colors"
                            title="Copiar"
                          >
                            {copiedIdx === i
                              ? <><Check className="w-3 h-3" /> Copiado</>
                              : <><Copy className="w-3 h-3" /> Copiar</>}
                          </button>
                          {onUseSuggestion && (
                            <button
                              type="button"
                              onClick={() => { onUseSuggestion(s); onClose(); }}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded transition-colors"
                              title="Usar esta resposta no campo de mensagem"
                            >
                              Usar <ArrowRightCircle className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
});
