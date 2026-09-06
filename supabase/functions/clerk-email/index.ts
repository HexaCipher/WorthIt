// Supabase Edge Function: clerk-email
// Receives Clerk's `email.created` webhook and sends the OTP email through Resend.
//
// Env secrets (set in Supabase Dashboard → Edge Functions → function → Secrets):
//   RESEND_API_KEY       – Resend API key (re_...)
//   CLERK_WEBHOOK_SECRET – Clerk webhook signing secret (whsec_...)
//   RESEND_FROM          – optional, e.g. "WorthIt <notifications@worthit.eu.cc>"
//
// Clerk dashboard → Developers → Webhooks → endpoint URL:
//   https://<project-ref>.supabase.co/functions/v1/clerk-email
// Subscribe to the `email.created` event, then disable "Delivered by Clerk"
// on the verification-code email template so emails are sent only once.
import { Webhook } from 'npm:svix@1.44.0'

// Then add the variable to the template if it doesn't exist yet:
//   resend templates create --name "WorthIt Verification" --html "..." --variables '[{"key":"code","type":"string"}]'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const CLERK_WEBHOOK_SECRET = Deno.env.get('CLERK_WEBHOOK_SECRET') ?? ''
const FROM = Deno.env.get('RESEND_FROM') ?? 'WorthIt <notifications@worth-it.live>'
const RESEND_TEMPLATE_ID = Deno.env.get('RESEND_TEMPLATE_ID') ?? '83d02a2a-e51c-401b-9875-6ed27ecf3b42'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // 1. Verify the Svix signature so only Clerk can trigger sends
  let evt: { type: string; data: Record<string, unknown> }
  try {
    const wh = new Webhook(CLERK_WEBHOOK_SECRET)
    evt = wh.verify(await req.text(), {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }) as { type: string; data: Record<string, unknown> }
  } catch (err) {
    console.error('[clerk-email] signature verification failed:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  if (evt.type !== 'email.created') {
    return new Response('ignored', { status: 200 })
  }

  const data = evt.data ?? {}
  const to = (data.to_email_address as string) ?? ''
  if (!to) {
    console.warn('[clerk-email] email.created without recipient — ignoring')
    return new Response('no recipient', { status: 200 })
  }

  // 2. Extract the 6-digit OTP. Prefer explicit fields, fall back to a
  //    regex over the payload (Clerk embeds the code in the rendered body).
  let code: string | undefined =
    (data.otp_code as string | undefined) ??
    ((data.data_fields as Record<string, string> | undefined)?.otp_code)
  if (!code) {
    const match = JSON.stringify(data).match(/(?<!\d)(\d{6})(?!\d)/)
    code = match?.[1]
  }
  if (!code) {
    console.warn('[clerk-email] no OTP code found in payload — ignoring')
    return new Response('no otp code', { status: 200 })
  }

  // 3. Send via Resend, referencing the published template (your custom design)
  //    Note: when `template` is used, the payload must NOT include html/text — only
  //    `from`, `to`, `subject`, and the template's variables. The template's own
  //    from/subject are empty, so we supply them here.
  const subject = (data.subject as string) ?? 'Your WorthIt verification code'

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      template: {
        id: RESEND_TEMPLATE_ID,
        variables: {
          code,
        },
      },
    }),
  })

  if (!resendRes.ok) {
    const errBody = await resendRes.text()
    console.error(`[clerk-email] Resend send failed (${resendRes.status}):`, errBody)
    // 500 makes Svix retry the delivery
    return new Response('Resend send failed', { status: 500 })
  }

  console.log(`[clerk-email] OTP sent to ${to} via Resend`)
  return new Response('sent', { status: 200 })
})
