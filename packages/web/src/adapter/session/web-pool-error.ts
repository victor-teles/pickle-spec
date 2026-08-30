export class IsolationVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IsolationVerificationError'
  }
}
