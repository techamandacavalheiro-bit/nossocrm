-- Separa o Copiloto (assistivo) do agente automático.
--
-- `ai_enabled` liga o agente que RESPONDE E ENVIA sozinho pro cliente
-- (lib/ai/agent/agent.service.ts → router.sendMessage). Na operação da Amanda ele
-- fica FALSE de propósito desde 22/07: quem fala com o lead é a Gaia, e dois robôs
-- no mesmo número seria um desastre.
--
-- Só que o Copiloto de Vendas estava preso na mesma flag — e ele nunca envia nada,
-- apenas sugere texto pro atendente humano. Resultado: "IA desativada na organização"
-- ao tentar usar o Copiloto, sem que houvesse como liberar um sem liberar o outro.
--
-- Esta coluna governa só as rotas assistivas (copilot, improve). Default TRUE:
-- quem nunca configurou nada continua com o Copiloto funcionando.

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS copilot_enabled BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN organization_settings.copilot_enabled IS
  'Liga o Copiloto de Vendas e o botão Melhorar (assistivos: sugerem ao atendente, nunca enviam). Independente de ai_enabled, que governa o agente automático que responde sozinho ao cliente.';

-- Quem já existe passa a ter o Copiloto ligado explicitamente.
UPDATE organization_settings SET copilot_enabled = TRUE WHERE copilot_enabled IS NULL;
