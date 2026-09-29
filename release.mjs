import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, 'dist')
const releaseDir = join(distDir, 'release')

function readPackage() {
  return JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))
}

// Zip names use a title-cased, filesystem-safe project name, e.g.
// "chat-float" -> "Chat-Float".
function zipLabel(name) {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .split(/[-._]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-') || 'Extension'
  )
}

function main() {
  const pkg = readPackage()
  const version = pkg.version
  const label = zipLabel(pkg.name || 'extension')

  console.log(`\n=== Packaging ${pkg.name} v${version} ===\n`)

  const browsers = [
    {name: 'Chrome', slug: 'chrome'},
    {name: 'Firefox', slug: 'firefox'},
    {name: 'Edge', slug: 'edge'},
  ]

  rmSync(releaseDir, {recursive: true, force: true})
  mkdirSync(releaseDir, {recursive: true})

  for (const b of browsers) {
    const outDir = join(distDir, b.slug)
    const zipName = `${label}-${b.name}-${version}.zip`

    if (!existsSync(outDir)) {
      throw new Error(`Missing build output: ${outDir}`)
    }

    const zipPath = join(releaseDir, zipName)
    console.log(`  Creating: dist/release/${zipName}`)
    execFileSync('zip', ['-qr', zipPath, '.', '-x', '*.DS_Store'], {
      cwd: outDir,
      stdio: 'inherit',
    })
  }

  console.log('\n=== Packaging complete ===\n')
  console.log('Output files:')
  for (const b of browsers) {
    console.log(`  dist/release/${label}-${b.name}-${version}.zip`)
  }
}

try {
  main()
} catch (err) {
  console.error(
    '\nRelease packaging failed:',
    err instanceof Error ? err.message : String(err),
  )
  process.exit(1)
}
