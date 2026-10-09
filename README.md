# Constelacao Site

Plataforma para divulgar cursos e eventos de Constelacao Familiar e gerenciar inscricoes.
O desenvolvimento segue as fases descritas em `1.docx`; esta primeira etapa entrega a base da API.

## Requisitos

- Node.js 20 ou superior
- PostgreSQL 14 ou superior

## Preparar ambiente

1. Copie `.env.example` para `.env`.
2. Defina `DATABASE_URL`, `JWT_SECRET` e `ADMIN_SETUP_TOKEN` com valores locais seguros. `UPLOAD_DIR` e opcional; por padrao, os arquivos ficam em `backend/uploads`.
3. Crie o banco configurado em `DATABASE_URL` com `npm run db:create`.
4. Instale as dependencias com `npm install`.
5. Execute `npm run db:migrate` e depois `npm run dev`.

No PowerShell do Windows, use `npm.cmd` caso a politica de execucao bloqueie `npm.ps1`.

## API inicial

- `GET /api/v1/health`: verificacao simples da API.
- `POST /api/v1/auth/setup`: cria o primeiro administrador. Requer o cabecalho `x-setup-token` igual a `ADMIN_SETUP_TOKEN` e so funciona enquanto nao houver usuarios.
- `POST /api/v1/auth/login`: autentica um usuario ativo.
- `GET /api/v1/auth/me`: retorna a identidade do token Bearer atual.

## Painel administrativo

1. Inicie a aplicacao com `npm run dev`.
2. Abra `http://localhost:3000/admin/`.
3. No primeiro acesso, escolha **Criar administrador** e informe o valor de `ADMIN_SETUP_TOKEN` configurado no `.env`. Essa criacao so funciona uma vez.
4. Entre com o e-mail e a senha definidos no primeiro acesso.

O painel permite gerenciar cursos, eventos, instrutores, inscricoes, contatos, configuracoes gerais e usuarios administrativos. Cursos, eventos e instrutores inativos sao preservados no banco. Cursos podem ser associados a varios instrutores ativos.

Os perfis `admin`, `editor` e `attendant` usam permissoes verificadas pela API. Somente administradores alteram configuracoes e usuarios; editores podem gerenciar cursos, eventos e instrutores; atendentes podem acompanhar inscricoes e contatos. O painel protege a ultima conta de administrador contra desativacao.

Administradores e editores com permissao de conteudo podem enviar imagens JPEG, PNG e WebP pelo painel (ate 8 MB por arquivo). Os uploads sao gravados em `UPLOAD_DIR` e disponibilizados em `/uploads/`; configure esse diretorio em armazenamento persistente ao publicar a aplicacao.

O painel de inscricoes permite filtrar por nome, e-mail, telefone, status, curso/evento e intervalo de datas. A exportacao CSV respeita os filtros aplicados e protege campos que poderiam ser interpretados como formulas por planilhas.

As configuracoes salvas no painel atualizam o nome, textos, cores, contatos, WhatsApp e redes sociais do site publico. Cadastros de instrutores ativos tambem aparecem na pagina inicial e nos cursos associados.

O catalogo publico agora possui paginas de detalhes para cursos, eventos e artigos, carregadas por slug e publicadas somente quando o registro esta ativo/publicado. Artigos aparecem em `/blog.html`; os links das listas abrem os detalhes correspondentes.

As configuracoes tambem permitem definir titulo e descricao SEO globais, palavras-chave, imagem Open Graph e codigo de verificacao do Google Search Console. Artigos e atividades publicas aplicam titulo, descricao e imagem especificos nos metadados da pagina. Google Analytics e Meta Pixel ainda nao carregam scripts; a integracao deve aguardar uma escolha explicita de consentimento de rastreamento.

Na mesma tela de configuracoes, administradores podem ativar/desativar e reordenar secoes da pagina inicial e itens do menu, editar os rotulos do menu e configurar o texto e a imagem do banner. A ordem e aplicada na pagina publica; os itens do menu habilitados sao compartilhados nas paginas publicas.

Cursos podem ser classificados por categorias e organizados em modulos numerados com descricao e carga horaria. Categorias e modulos sao gerenciados no painel; registros inativos sao preservados, e apenas modulos ativos aparecem no detalhe publico do curso. A migration `005_course_categories_modules.sql` adiciona as tabelas e deve ser aplicada com `npm run db:migrate`.

Na tela **Galeria**, cada foto pode ser associada a um nome de galeria (por exemplo, "Formacao 2026" ou "Workshop"). Varias fotos podem compartilhar o mesmo nome e sao exibidas agrupadas na pagina inicial. Fotos existentes sao mantidas na "Galeria geral" apos a migration `008_named_galleries.sql`.

A **Biblioteca de arquivos** no painel organiza imagens, videos, documentos PDF/TXT e materiais de curso. Arquivos enviados podem ser consultados, filtrados, abertos e ter o link copiado; os campos de imagem de cursos, eventos, artigos, instrutores e galeria tambem podem reutilizar imagens da biblioteca. A migration `009_media_library.sql` registra os arquivos enviados. Limites por arquivo: 8 MB para imagens, 100 MB para videos e 20 MB para PDF/TXT.

Pagamentos online usam o checkout hospedado do Mercado Pago. Configure ambiente, token de acesso, chave secreta de assinatura do webhook, URL publica HTTPS e limite de parcelas em **Configuracoes**. Cadastre no Mercado Pago o webhook `https://SEU-DOMINIO/api/v1/payments/webhook` para pagamentos e informe a chave de assinatura fornecida pelo Mercado Pago. Apenas atividades com preco maior que zero geram checkout; sem pagamento ativo, as inscricoes continuam no fluxo atual. A confirmacao automatica valida assinatura, identificador, status, moeda e valor consultando a API do provedor; os dados do cartao nao passam pelo site. As migrations `010_mercado_pago_payments.sql` e `011_mercado_pago_payment_attempts.sql` criam a cobranca e registram cada tentativa de pagamento. Mantenha `JWT_SECRET` estavel para descriptografar as credenciais salvas.

Novas inscricoes geram e-mails para o participante e para a equipe por meio de uma fila transacional com retentativas. As migrations `006_enrollment_notifications.sql` e `007_smtp_panel_settings.sql` criam a fila e as configuracoes SMTP. Servidor, porta, TLS, usuario, remetente e senha SMTP sao configurados pelo painel em **Configuracoes**. A senha e criptografada com AES-256-GCM usando `JWT_SECRET` como chave derivada; mantenha esse segredo estavel e protegido, pois troca-lo impede a leitura da senha SMTP armazenada. O destinatario administrativo e os assuntos e mensagens dos e-mails tambem podem ser alterados na tela **Configuracoes**; os modelos aceitam `{{name}}`, `{{email}}`, `{{phone}}`, `{{activity}}`, `{{type}}`, `{{date}}` e `{{siteName}}`. Sem SMTP ativo, as notificacoes ficam pendentes na fila.

Exemplo para iniciar o administrador:

```json
{
  "name": "Administradora",
  "email": "admin@exemplo.com",
  "password": "uma-senha-forte-com-12-caracteres"
}
```

O endpoint de setup deve ser usado uma unica vez. Guarde o token JWT apenas durante a sessao da aplicacao; nao grave credenciais administrativas no frontend.

## Comandos

- `npm run dev`: inicia a API com reinicio automatico.
- `npm test`: executa testes HTTP sem exigir banco configurado.
- `npm run db:create`: cria o banco configurado em `DATABASE_URL`, se ainda nao existir.
- `npm run db:migrate`: aplica as migrations pendentes.

## Etapas

1. Base da API, banco, autenticacao e permissoes.
2. Site publico responsivo.
3. Painel administrativo e gestao de cursos, eventos e inscricoes.
4. Blog, galeria, depoimentos e FAQ.
5. SEO, WhatsApp, redes sociais e formularios.
6. Integracoes financeiras.
