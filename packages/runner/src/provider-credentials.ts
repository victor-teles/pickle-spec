export const providerCredentialEnvironmentNames = [
  'AI_GATEWAY_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'CEREBRAS_API_KEY',
  'COHERE_API_KEY',
  'DEEPSEEK_API_KEY',
  'FIREWORKS_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'PERPLEXITY_API_KEY',
  'TOGETHER_AI_API_KEY',
  'VERCEL_AI_GATEWAY_API_KEY',
  'XAI_API_KEY',
] as const

export type ProviderCredentialEnvironment = Record<string, string | undefined>

export function assertNoProviderCredentials(
  environment: ProviderCredentialEnvironment,
  consumer: string,
): void {
  const exposedCredential = providerCredentialEnvironmentNames.find(
    (name) => environment[name] !== undefined,
  )
  if (exposedCredential) {
    throw new Error(
      `${consumer} must not receive provider credentials: ${exposedCredential}`,
    )
  }
}

export function removeProviderCredentials(
  environment: ProviderCredentialEnvironment,
): void {
  for (const name of providerCredentialEnvironmentNames) {
    delete environment[name]
  }
}
