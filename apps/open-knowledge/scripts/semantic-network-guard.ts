import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { syncBuiltinESMExports } from 'node:module'

const deny = (): never => {
	throw new Error('Network forbidden in offline semantic smoke test')
}
globalThis.fetch = Object.assign(deny, { preconnect: deny })
http.request = deny
http.get = deny
https.request = deny
https.get = deny
net.connect = deny
net.createConnection = deny
syncBuiltinESMExports()
