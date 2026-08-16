# Clean examples

Use these as judgment, not as a mandate to introduce the "after" shape.
Apply a rewrite only when the touched code already has the "before" problem.
Examples are JavaScript; follow the repository's language and conventions.

## Clean Code

### Names and domain language

```js
// ❌
const u = users.filter(x => x.a)
if (transaction.status === 3) doStuff(transaction)

// ✅
const activeUsers = users.filter(user => user.active)
if (transaction.status === TransactionStatus.SETTLED) {
  distributeReceivable(transaction)
}
```

### Early returns and positive conditions

```js
// ❌
function processPayment(payment) {
  if (payment) {
    if (payment.amount > 0) {
      if (payment.status === 'pending') {
        return charge(payment)
      }
    }
  }
}

if (!user.isNotActive) sendNotification(user)

// ✅
function processPayment(payment) {
  if (!payment) return
  if (payment.amount <= 0) return
  if (payment.status !== 'pending') return
  return charge(payment)
}

if (user.isActive) sendNotification(user)
```

### Named constants and extracted rules

```js
// ❌
if (user.failedAttempts >= 5) blockUser(user, 900)

if (
  user.age >= 18 &&
  user.status === 'active' &&
  user.kycStatus === 'approved' &&
  !user.blocked
) {
  enableTransfers(user)
}

// ✅
const maxLoginAttempts = 5
const blockDurationSeconds = 15 * 60
if (user.failedAttempts >= maxLoginAttempts) {
  blockUser(user, blockDurationSeconds)
}

function canUserTransfer(user) {
  return (
    user.age >= 18 &&
    user.status === 'active' &&
    user.kycStatus === 'approved' &&
    !user.blocked
  )
}

if (canUserTransfer(user)) enableTransfers(user)
```

### Array methods, lookups, and comments

```js
// ❌
const activeUsers = []
for (const user of users) {
  if (user.active) activeUsers.push(user)
}
users.map(user => sendEmail(user))

if (status === 'pending') return 'Waiting'
if (status === 'approved') return 'Approved'
if (status === 'rejected') return 'Rejected'

// Check if user age is greater than or equal to 18
if (user.age >= 18) allowUser()

// ✅
const activeUsers = users.filter(user => user.active)
users.forEach(user => sendEmail(user))
const userIds = users.map(user => user.id)

const statusLabels = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
}
return statusLabels[status] ?? 'Unknown'

const isAdult = user.age >= 18
if (isAdult) allowUser()

// Bank provider rejects transfers with accented characters.
const normalizedName = removeDiacritics(customer.name)
```

### Errors, options, and domain vs infrastructure

```js
// ❌
createUser(data, true, false)
throw new Error('Error')

async function canWithdraw(userId, amount) {
  const user = await db.query('SELECT * FROM users WHERE id = ?', [userId])
  return user.balance >= amount && user.status === 'active'
}

// ✅
createUser(data, { sendEmail: true, createSubscription: false })
throw new Error(`Transaction ${transactionId} was not found`)

function canWithdraw(user, amount) {
  return user.status === 'active' && user.balance >= amount
}

async function withdraw(userId, amount) {
  const user = await userRepository.findById(userId)
  if (!canWithdraw(user, amount)) throw new WithdrawalNotAllowedError()
}
```

## KISS

Prefer the smallest readable solution. Do not add a class, helper, or options
bag unless a second real use already exists.

```js
// ❌
function isAdult(age) {
  if (age >= 18) return true
  return false
}

class UserNameFormatter {
  format(user) {
    return `${user.firstName} ${user.lastName}`
  }
}

function greet(name) {
  if (!name) name = 'Guest'
  return `Hello, ${name}`
}

const city = user && user.address && user.address.city ? user.address.city : null
const names = users.reduce((result, user) => {
  result.push(user.name)
  return result
}, [])
const isValid = !!~allowedRoles.indexOf(user.role)

function calculatePrice({
  price,
  quantity,
  multiplier = 1,
  transformer = value => value,
}) {
  return transformer(price * quantity * multiplier)
}

// ✅
function isAdult(age) {
  return age >= 18
}

const name = `${user.firstName} ${user.lastName}`

function greet(name = 'Guest') {
  return `Hello, ${name}`
}

const city = user?.address?.city ?? null
const names = users.map(user => user.name)
const isValid = allowedRoles.includes(user.role)

function calculatePrice(price, quantity) {
  return price * quantity
}
```

Keep functions small by extracting names, not layers. A function is too
large when types, fallbacks, and the call are all inline.

```js
// ❌ inline parameter type, nested fallbacks, omit-if-undefined spreads
async function ensureClient(input: {
  browser: BrowserOptions
  signal?: AbortSignal
}) {
  const model = {
    modelName: (input.browser.modelName ??
      options.modelName ??
      'anthropic/claude-sonnet-4-6') as ModelConfig['modelName'],
    ...((input.browser.modelApiKey ?? options.modelApiKey)
      ? { apiKey: (input.browser.modelApiKey ?? options.modelApiKey)! }
      : {}),
  }

  return Client.create({
    model,
    selfHeal: input.browser.selfHeal ?? options.selfHeal ?? true,
    ...((input.browser.cache ?? options.cache) !== undefined
      ? { cache: input.browser.cache ?? options.cache }
      : {}),
  })
}

// ✅ named type, named fallbacks, plain config object
type ClientContext = {
  browser: BrowserOptions
  signal?: AbortSignal
}

async function ensureClient(input: ClientContext) {
  if (client) return client
  const modelName =
    input.browser.modelName ??
    options.modelName ??
    'anthropic/claude-sonnet-4-6'
  const modelApiKey = input.browser.modelApiKey ?? options.modelApiKey
  const domSettleTimeoutMs =
    input.browser.domSettleTimeoutMs ?? options.domSettleTimeoutMs ?? 3_000

  client = await Client.create({
    browser,
    model: {
      modelName: modelName as ModelConfig['modelName'],
      apiKey: modelApiKey,
    },
    logging: { level: 'off', format: 'json' },
    selfHeal: input.browser.selfHeal ?? options.selfHeal ?? true,
    domSettleTimeoutMs,
    cache: input.browser.cache ?? options.cache,
  })
  return client
}
```

Do not extract a one-off rename. Do extract a fallback that would clutter
the object.

```js
// ❌ rename with no extra meaning
const city = user.city
return { city }

// ❌ fallback still buried in the object
return Client.create({
  timeout: input.timeout ?? options.timeout ?? 3_000,
})

// ✅ fallback resolved first
const timeout = input.timeout ?? options.timeout ?? 3_000
return Client.create({ timeout })
```

Keep orchestration thin. Do not pull unrelated side effects into a function
just to have one entry point, and do not split a one-line body into classes.

```js
// ❌ too much in one place — and also too much ceremony to "fix" it
function createUser(data) {
  validateUser(data)
  const user = saveUser(data)
  sendWelcomeEmail(user)
  trackAnalytics(user)
  return user
}

// ✅ during cleanup, separate only what the diff already mixed
function createUser(data) {
  validateUser(data)
  return saveUser(data)
}

const user = createUser(data)
sendWelcomeEmail(user)
trackAnalytics(user)
```

## Separation of concerns and file size

A file is too large when it hosts more than one job. Split by concern into
neighboring files. Do not create a file per function.

```js
// ❌ one module validates options, builds the client, and runs the session
// adapter.js
export function validateAdapterOptions(value) { /* field-by-field checks */ }

const clientFactory = {
  async launch(options) {
    const browser = await launchBrowser(options)
    return createClient(browser, options)
  },
}

export function createAdapter(options) {
  const validated = validateAdapterOptions(options)
  return {
    async openSession() {
      const client = await clientFactory.launch(validated)
      return runSession(client)
    },
  }
}

// ✅ each concern in its own file; adapter only composes
// adapter-options.js
export function validateAdapterOptions(value) { /* field-by-field checks */ }

// client-factory.js
export const clientFactory = {
  async launch(options) {
    const browser = await launchBrowser(options)
    return createClient(browser, options)
  },
}

// adapter.js
export { validateAdapterOptions } from './adapter-options'
import { clientFactory } from './client-factory'

export function createAdapter(options) {
  const validated = validateAdapterOptions(options)
  return {
    async openSession() {
      const client = await clientFactory.launch(validated)
      return runSession(client)
    },
  }
}
```

Do not split a cohesive scan-sized module, and do not invent a layer for
one helper.

```js
// ❌ file-per-function
// is-adult.js
export function isAdult(age) {
  return age >= 18
}

// ❌ speculative folder for one implementation
// adapters/http/factories/user-client/index.js

// ✅ keep a small cohesive module together
// eligibility.js
export function isAdult(age) {
  return age >= 18
}
export function canUserTransfer(user) {
  return isAdult(user.age) && user.status === 'active'
}
```

## DRY

DRY is about duplicated knowledge, rules, and logic. Do not extract just
because two snippets look similar.

```js
// ❌ same rule copied
const johnTotal = john.price * john.quantity
const maryTotal = mary.price * mary.quantity

if (role === 'admin' || role === 'manager' || role === 'supervisor') {
  allowAccess()
}

if (!user.email) throw new Error('Email is required')
if (!admin.email) throw new Error('Email is required')

// checkout.js
const canPurchase = user.active && user.age >= 18
// payment.js
const canPay = user.active && user.age >= 18

// ✅ one place for the rule
const calculateTotal = ({ price, quantity }) => price * quantity
const johnTotal = calculateTotal(john)
const maryTotal = calculateTotal(mary)

const allowedRoles = ['admin', 'manager', 'supervisor']
if (allowedRoles.includes(role)) allowAccess()

function validateEmail(email) {
  if (!email) throw new Error('Email is required')
}

function isEligibleCustomer(user) {
  return user.active && user.age >= 18
}
```

Do not copy unknown-object guards. Parse untrusted input with a schema and
trust the inferred type inside the module.

```ts
// ❌ isRecord / record() / as unknown as T
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}
function validateOptions(value: unknown): Options {
  const options = record(value, 'options')
  return options as unknown as Options
}
function createClient(options: Options) {
  const validated = validateOptions(options)
  return connect(validated)
}

// ✅ schema at the I/O edge, typed function trusts T
const optionsSchema = z.strictObject({
  baseUrl: z.url(),
})
type Options = z.infer<typeof optionsSchema>

function validateOptions(value: unknown): Options {
  return optionsSchema.parse(value)
}
function createClient(options: Options) {
  return connect(options)
}
```

Reuse shared configuration and request setup when the copies must stay in
sync. Leave them separate when endpoints or headers may diverge.

```js
// ❌
fetch('https://api.example.com/users')
fetch('https://api.example.com/orders')

const users = await fetch('/api/users', {
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
})

// ✅
const apiUrl = 'https://api.example.com'
fetch(`${apiUrl}/users`)
fetch(`${apiUrl}/orders`)

function apiFetch(path) {
  return fetch(`/api${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
}
```

## SOLID

Use these shapes when the touched code already has the problem. Do not
introduce them as ceremony.

### S — one reason to change

Split only when validation, persistence, and notifications are already mixed
and changing for different reasons. The same rule applies to files: do not
keep those jobs in one module once the mix is already painful.

```js
// ❌ one unit changing for three reasons
class UserService {
  createUser(user) {
    if (!user.email) throw new Error('Email is required')
    database.save(user)
    emailProvider.send(user.email, 'Welcome!')
  }
}

// ✅ collaborators already exist, or the mix is already painful
class UserService {
  constructor(validator, repository, emailService) {
    this.validator = validator
    this.repository = repository
    this.emailService = emailService
  }

  createUser(user) {
    this.validator.validate(user)
    this.repository.save(user)
    this.emailService.sendWelcomeEmail(user)
  }
}
```

### O — extend instead of modify

```js
// ❌ every new method edits the same function
function processPayment(type, amount) {
  if (type === 'pix') console.log(`Pix payment: ${amount}`)
  if (type === 'credit_card') console.log(`Credit card payment: ${amount}`)
  if (type === 'paypal') console.log(`PayPal payment: ${amount}`)
}

// ✅ real variants already exist
function processPayment(paymentMethod, amount) {
  paymentMethod.pay(amount)
}
```

### L — honor the parent contract

```js
// ❌ subtype breaks callers that expect fly()
class Bird {
  fly() {
    console.log('Flying')
  }
}
class Penguin extends Bird {
  fly() {
    throw new Error("Penguins can't fly")
  }
}

// ✅ inherit only supported behavior
class Bird {
  eat() {
    console.log('Eating')
  }
}
class FlyingBird extends Bird {
  fly() {
    console.log('Flying')
  }
}
class Penguin extends Bird {
  swim() {
    console.log('Swimming')
  }
}
```

### I — small capability-based contracts

```js
// ❌ large base class forces unused methods
class Worker {
  work() {}
  eat() {}
  sleep() {}
}
class Robot extends Worker {
  eat() {
    throw new Error("Robots don't eat")
  }
}

// ✅ consumers depend only on what they call
function executeWork(worker) {
  worker.work()
}
```

### D — inject volatile I/O

```js
// ❌ policy constructs the database
class UserService {
  constructor() {
    this.repository = new MySQLUserRepository()
  }
}

// ✅ policy receives the collaborator
class UserService {
  constructor(repository) {
    this.repository = repository
  }
}
```

Several principles can apply at once without extra layers:

```js
class PaymentService {
  constructor(paymentGateway, transactionRepository) {
    this.paymentGateway = paymentGateway
    this.transactionRepository = transactionRepository
  }

  async pay(transaction) {
    const result = await this.paymentGateway.charge(transaction.amount)
    await this.transactionRepository.save({
      ...transaction,
      externalId: result.id,
    })
    return result
  }
}
```

- **S:** charging and persistence are separate.
- **O:** a new gateway does not edit `PaymentService`.
- **D:** the service receives its collaborators.
