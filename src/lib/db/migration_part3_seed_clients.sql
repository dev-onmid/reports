INSERT INTO clients (id, name, segment, status) VALUES ('1', 'Tech Solutions', 'Tecnologia', 'Ativo') ON CONFLICT DO NOTHING;
INSERT INTO clients (id, name, segment, status) VALUES ('2', 'OdontoPrime', 'Saúde', 'Ativo') ON CONFLICT DO NOTHING;
INSERT INTO clients (id, name, segment, status) VALUES ('3', 'Bella Imóveis', 'Imobiliária', 'Alerta') ON CONFLICT DO NOTHING;
