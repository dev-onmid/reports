INSERT INTO meta_integration (id) VALUES ('global') ON CONFLICT DO NOTHING;

INSERT INTO users (id, name, email, password, role, status) VALUES ('1', 'Admin', 'admin@onmid.com', 'admin123', 'Administrador', 'Ativo') ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, status) VALUES ('4', 'Matheus', 'matheus@onmid.com.br', '1234', 'Administrador', 'Ativo') ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, status) VALUES ('2', 'Maria Silva', 'maria@onmid.com', 'maria123', 'Usuário', 'Ativo') ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, status) VALUES ('3', 'João Costa', 'joao@onmid.com', 'joao123', 'Visualizador', 'Inativo') ON CONFLICT DO NOTHING;

INSERT INTO user_permissions (user_id, dashboard, clientes, relatorios, configuracoes, integracoes) VALUES ('1', TRUE, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO user_permissions (user_id, dashboard, clientes, relatorios, configuracoes, integracoes) VALUES ('4', TRUE, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO user_permissions (user_id, dashboard, clientes, relatorios, configuracoes, integracoes) VALUES ('2', TRUE, TRUE, TRUE, FALSE, FALSE) ON CONFLICT DO NOTHING;
INSERT INTO user_permissions (user_id, dashboard, clientes, relatorios, configuracoes, integracoes) VALUES ('3', TRUE, FALSE, FALSE, FALSE, FALSE) ON CONFLICT DO NOTHING;
