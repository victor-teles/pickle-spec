# language: pt
Funcionalidade: Busca

  Cenário: Visitar página principal
    Dado que eu navego para a página principal
    Quando eu digito "Brasil" no campo de busca e pressiono enter
    Então eu devo ver resultados de busca relacionados ao Brasil

  Cenário: Buscar por imagens
    Dado que eu navego para a página principal
    Quando eu digito "paisagens do Brasil" no campo de busca e pressiono enter
    E eu clico na aba "Imagens"
    Então eu devo ver resultados de imagens

  Cenário: Buscar e verificar sugestões
    Dado que eu navego para a página principal
    Quando eu digito "clima em São Paulo" no campo de busca
    Então eu devo ver sugestões de autocompletar

  Cenário: Acessar o botão "Estou com sorte"
    Dado que eu navego para a página principal
    Então eu devo ver o botão "Estou com sorte"

  Cenário: Buscar sem resultados
    Dado que eu navego para a página principal
    Quando eu digito "0bebfb28b5a3ead3b1b60ae3b09b6a52cc5e96dd57652758b9fb4dd0c749acd1" no campo de busca e pressiono enter
    Então eu devo ver uma mensagem de nenhum resultado encontrado

  Cenário: Verificar título da página
    Dado que eu navego para a página principal
    Então o título da página deve ser "Google"
