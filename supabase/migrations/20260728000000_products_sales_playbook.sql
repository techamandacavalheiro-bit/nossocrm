-- Playbook de vendas por produto — alimenta o Copiloto de Vendas.
--
-- Até aqui o copiloto só conhecia UM texto (organization_settings.sales_script),
-- então falava genérico e era proibido de citar preço. Com estes campos, o
-- atendente escolhe o produto na conversa e a IA responde com o número, a
-- condição e o contorno de objeção certos daquele produto.
--
-- Estende a tabela `products` que já existe (referenciada por deal_items e
-- boards.default_product_id) em vez de criar um catálogo paralelo.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS promise         TEXT,
  ADD COLUMN IF NOT EXISTS audience        TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms   TEXT,
  ADD COLUMN IF NOT EXISTS deliverables    TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url    TEXT,
  ADD COLUMN IF NOT EXISTS objections      JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS copilot_enabled BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN public.products.promise IS
  'A transformação que o produto entrega. Usada pela IA pra escolher o ângulo da abordagem.';
COMMENT ON COLUMN public.products.audience IS
  'Pra quem é (e pra quem NÃO é) este produto.';
COMMENT ON COLUMN public.products.payment_terms IS
  'Parcelamento, formas de pagamento e garantia. É a fonte autorizada de preço pro copiloto.';
COMMENT ON COLUMN public.products.deliverables IS
  'O que está incluso — a lista de entregas.';
COMMENT ON COLUMN public.products.objections IS
  'Lista [{"q": "objeção do cliente", "a": "contorno pronto"}] injetada na aba Objeção do copiloto.';
COMMENT ON COLUMN public.products.copilot_enabled IS
  'Se aparece no seletor do Copiloto. Produto de captação (workshop grátis) fica false.';
