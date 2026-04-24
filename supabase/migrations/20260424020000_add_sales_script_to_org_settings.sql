-- Adiciona o campo sales_script em organization_settings.
--
-- Armazena o "script de vendas" configurável por organização: tom de voz,
-- etapas do funil, regras de preço, objeções comuns, exemplos. Esse texto
-- é injetado como system prompt em todas as ações do Copiloto de Vendas
-- (sugerir / analisar / objeção / perguntar).

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS sales_script TEXT;

COMMENT ON COLUMN organization_settings.sales_script IS
  'Prompt de vendas customizado da organização. Injetado como system prompt nas ações do Copiloto. Aceita markdown.';
