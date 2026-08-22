export const webBenchmarkProviderCredentialEnvironmentNames = [
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

type WebBenchmarkEnvironment = Record<string, string | undefined>

export function assertNoWebBenchmarkProviderCredentials(
  environment: WebBenchmarkEnvironment,
): void {
  const exposedCredential = webBenchmarkProviderCredentialEnvironmentNames.find(
    (name) => environment[name] !== undefined,
  )
  if (exposedCredential) {
    throw new Error(
      `Controlled web benchmark must not receive provider credentials: ${exposedCredential}`,
    )
  }
}

export function removeWebBenchmarkProviderCredentials(
  environment: WebBenchmarkEnvironment,
): void {
  for (const name of webBenchmarkProviderCredentialEnvironmentNames) {
    delete environment[name]
  }
}
