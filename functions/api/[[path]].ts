/// <reference types="@cloudflare/workers-types" />
import { handleApi, type Env } from '../../worker/index'

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleApi(request, env)
