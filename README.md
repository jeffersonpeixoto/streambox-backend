# StreamBox IPTV TV + Backend

## O que esta versão resolve

- Backend intermediário Node/Express.
- O navegador não acessa diretamente a API Xtream.
- A conta é salva localmente no dispositivo.
- Na abertura, o backend consulta apenas login + categorias.
- Conteúdo é carregado somente quando a categoria é selecionada.
- O backend possui endpoint `/proxy/stream` para reprodução, reduzindo problemas de CORS.
- Interface em modo paisagem, pensada para Google TV.
- Navegação por controle remoto/D-pad: ↑ ↓ ← → e OK/Enter.
- Categorias, TV ao vivo, filmes e base para séries.

## Instalação

Requer Node.js 20+.

```bash
npm install
npm start
```

Abra `http://localhost:8080`.

Para publicar, use um servidor Node com HTTPS. Configure `APP_ORIGIN` para o domínio do PWA quando possível.

## Importante

O proxy apenas encaminha requisições e não armazena conteúdo. Use somente serviços/listas para os quais você tenha autorização.
