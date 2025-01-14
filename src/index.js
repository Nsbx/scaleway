process.env.SENTRY_DNS =
  process.env.SENTRY_DNS ||
  'https://f5e851d01e0f4ce3b19a13246b2af7cb@errors.cozycloud.cc/43'

const {
  BaseKonnector,
  requestFactory,
  saveBills,
  log,
  errors,
  solveCaptcha,
  cozyClient
} = require('cozy-konnector-libs')

const dayjs = require('dayjs')
dayjs.locale('fr')

const request = requestFactory({
  cheerio: false,
  json: true
})

const baseUrl = 'https://billing.scaleway.com/invoices'

const currencySymbols = {
  EUR: '€',
  USD: '$'
}

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  const token = await authenticate(
    fields.login,
    fields.password,
    fields.twoFACode
  )
  log('info', 'Successfully logged in, token created')
  try {
    log('info', 'Fetching the list of documents')
    log('info', `With the token ${token.slice(0, 9)}...`)
    const userInfos = await request({
      uri: `https://api.scaleway.com/account/v1/users/${jwtResponse.jwt.issuer}`,
      headers: {
        'X-Session-Token': token,
        'User-Agent': userAgent
      }
    })

    const organizationId = userInfos.user.organizations[0].id
    const { invoices } = await request({
      uri: `${baseUrl}&organization_id=${organizationId}`,
      headers: {
        'X-Session-Token': token,
        'User-Agent': userAgent
      }
    })
    log('info', 'Parsing list of documents')
    const documents = invoices
      .filter(invoice => invoice.state === 'paid')
      .map(
        ({
          organization_id,
          start_date,
          id,
          total_taxed: amount,
          currency
        }) => ({
          fileurl: `https://billing.scaleway.com/invoices/${organization_id}/${start_date}/${id}?format=pdf&x-auth-token=${token}`,
          filename: `${dayjs(new Date(start_date)).format(
            'YYYY-MM-DD'
          )}_${amount}${currencySymbols[currency] || '_' + currency}.pdf`,
          vendor: 'scaleway',
          date: new Date(start_date),
          amount: parseFloat(amount),
          currency: currency,
          fileAttributes: {
            metadata: {
              contentAuthor: 'scaleway.com',
              issueDate: new Date(),
              datetime: new Date(start_date),
              datetimeLabel: `issueDate`,
              carbonCopy: true,
              qualification: Qualification.getByLabel('web_service_invoice')
            }
          }
        })
      )

    // here we use the saveBills function even if what we fetch are not bills, but this is the most
    // common case in connectors
    log('info', 'Saving data to Cozy')
    await saveBills(documents, fields.folderPath, {
      // this is a bank identifier which will be used to link bills to bank operations. These
      // identifiers should be at least a word found in the title of a bank operation related to this
      // bill. It is not case sensitive.
      identifiers: ['scaleway.com'],
      fileIdAttribute: ['filename'],
      sourceAccount: fields.login,
      sourceAccountIdentifier: fields.login,
      contentType: 'application/pdf'
    })
  } finally {
    await clearToken(token, id_jti)
  }
}

async function clearToken(token, id_jti) {
  const response = await request({
    method: 'DELETE',
    uri: `https://api.scaleway.com/account/v1/jwt/${id_jti}`,
    headers: {
      'x-session-token': token,
      'User-Agent': userAgent
    }
  })
  log('info', `token deleted: ${JSON.stringify(response)}`)
}

async function authenticate(email, password, twoFACode = null) {
  let requestBody = {
    email: email,
    password: password
  }

  if (twoFACode !== null) {
    requestBody['2FA_token'] = twoFACode
  }

  try {
    const jwtResponse = await request({
      method: 'POST',
      uri: 'https://account.scaleway.com/tokens',
      body: requestBody
    })
    return jwtResponse
  } catch (err) {
    if (
      err.message ===
      '401 - {"type":"captcha_required","message":"Missing Captcha"}'
    ) {
      const gRecaptcha = await solveCaptcha({
        websiteKey: '6LfvYbQUAAAAACK597rFdAMTYinNYOf_zbiuvMWA',
        websiteURL: 'https://console.scaleway.com/login-password'
      })
      const jwtResponse = await request({
        method: 'POST',
        uri: 'https://api.scaleway.com/account/v1/jwt',
        body: {
          captcha: gRecaptcha,
          email,
          password,
          renewable: false
        },
        headers: {
          'User-Agent': userAgent
        }
      })
      return jwtResponse
    } else {
      log('error', err.message)
      throw errors.LOGIN_FAILED
    }
  }
}
