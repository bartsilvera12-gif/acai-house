-- Datos de flujo: un registro por (conversación, flow_code, field_name).
-- Antes solo (conversation_id, field_name): otro flujo o sesión podía pisar nombre/cédula/monto
-- y mezclar participantes entre ejecuciones del mismo chat.

DROP INDEX IF EXISTS public.uq_chat_flow_data_conversation_field;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_flow_data_conversation_flow_field
  ON public.chat_flow_data(conversation_id, flow_code, field_name);

COMMENT ON INDEX public.uq_chat_flow_data_conversation_flow_field IS
  'Evita colisión entre flujos en la misma conversación; upsert debe usar conversation_id+flow_code+field_name.';
