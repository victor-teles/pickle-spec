# language: pt
Funcionalidade: Busca

  Cenário: Visitar página principal
    Dado que eu navego para a página principal
    Quando eu digito "Brasil" no campo de busca e pressiono enter
    Então eu devo ver resultados de busca relacionados ao Brasil
