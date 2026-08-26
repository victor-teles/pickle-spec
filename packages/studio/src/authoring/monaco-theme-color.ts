type MonacoHexOptions = {
  omitHash?: boolean
}

// Monaco parses theme colors as hex, so convert the OKLCH source palette only
// at its API boundary.
const oklchPattern =
  /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/

function linearToSrgb(value: number) {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

function colorByte(value: number) {
  const channel = Math.round(Math.max(0, Math.min(1, value)) * 255)
  return channel.toString(16).padStart(2, '0')
}

export function oklchToMonacoHex(
  color: string,
  options: MonacoHexOptions = {},
) {
  const match = oklchPattern.exec(color)
  if (!match) throw new Error(`Invalid OKLCH color: ${color}`)

  const lightness = Number(match[1])
  const chroma = Number(match[2])
  const hueRadians = (Number(match[3]) * Math.PI) / 180
  const alpha = match[4] ? Number(match[4]) : 1
  const a = chroma * Math.cos(hueRadians)
  const b = chroma * Math.sin(hueRadians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const red = linearToSrgb(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
  )
  const green = linearToSrgb(
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
  )
  const blue = linearToSrgb(
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  )
  const channels = [red, green, blue].map(colorByte).join('')
  const alphaChannel = alpha < 1 ? colorByte(alpha) : ''
  const prefix = options.omitHash ? '' : '#'

  return `${prefix}${channels}${alphaChannel}`
}
