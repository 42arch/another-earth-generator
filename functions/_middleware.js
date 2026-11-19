const canonicalHost = 'another-earth.starllow.com'
const redirectHosts = new Set([
  'aeg.starllow.com',
  'another-earth-generator.starllow.com',
  'earth.starllow.com',
])

export async function onRequest({ request, next }) {
  const target = new URL(request.url)

  if (!redirectHosts.has(target.hostname)) {
    return next()
  }

  target.protocol = 'https:'
  target.hostname = canonicalHost

  return Response.redirect(target.toString(), 301)
}
