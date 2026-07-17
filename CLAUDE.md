# Contexto do negócio

Este app controla e registra o fluxo de matéria-prima e produto acabado de uma fábrica de panificação/confeitaria (salgados, pães especiais, pão de queijo, helicoidal, hotelaria, pré-assados).

## Layout da fábrica (setores)

- **Recebimento Matéria Prima** → **Estoque Matéria-Prima** (câmaras de lácteos, fermento, cárneos, congelados, recheios)
- **Sala PCP/Reuniões**, **Pré-Pesagem**, **Sala Preparo (Leite/Ovos/Queijo)**, salas de preparo de pão de queijo, pães, FLV
- **Barreira Sanitária** → **Sala da Qualidade** → **Cozinha Salgado**
- Setores de produção: **Salgado**, **Pães Especiais**, **Pão de Queijo**, **Helicoidal**, **Confeitaria/Pré-assado/Hotelaria**
- **Túneis de congelamento (1–6)**
- **Embaladora Especiais/Salgado** e **Embaladora Helicoidal/Pão de Queijo**
- **Câmaras de Produto Acabado** → **Expedição** (Sala Expedição / Sala Logística) → **Carregamento/Rota**

## Fluxo operacional

1. **Programação (PCP)**: ordens de produção são lançadas com **48h de antecedência**, seguindo um quadro de produção baseado no histórico de vendas dos últimos meses.
2. **Estoque**: recebe as ordens e separa os insumos necessários, enviando para pré-pesagem e salas de preparo.
3. **Salas de preparo**: fracionam os insumos em **kits**, com **24h de antecedência** em relação à produção.
4. **Alimentador**: entrega os kits para os setores de produção.
5. **Produção**: no dia seguinte, executa a produção programada usando os kits recebidos.
6. **Embaladora → Câmara de Produto Acabado → Expedição → Carregamento**: fluxo do produto acabado até a saída.

## Módulos existentes no app (src/pages)

- `PCP.jsx`, `Programacao.jsx`, `ResumoPCP.jsx`: programação de ordens (janela de 48h)
- `Estoque.jsx`, `Inbound.jsx`, `Inventory.jsx`: recebimento e controle de matéria-prima, separação/pré-pesagem
- `Operador.jsx`, `Lider.jsx`, `LivroProducao.jsx`: execução da produção (kits recebidos com 24h de antecedência)
- `Embaladora.jsx`, `MovimentacaoPA.jsx`: embalagem e movimentação de produto acabado
- `Outbound.jsx`, `Expedicao.jsx`: expedição e carregamento
- `Dashboard.jsx`, `Relatorio.jsx`, `Fechamento.jsx`, `PainelTV.jsx`, `AlertasSistema.jsx`: visão gerencial e acompanhamento
- `services/consumoMP.js`: cálculo de consumo de matéria-prima
- `services/firebase.js`: persistência/backend

Ao propor mudanças, considerar sempre essas janelas de tempo (48h para ordem, 24h para kit) e a sequência física real do fluxo (estoque → preparo/kit → produção → embalagem → câmara PA → expedição).
