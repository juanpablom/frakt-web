import { useLocalStorageState } from './../utils/utils'
import {
  Account,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import React, { useContext, useEffect, useMemo, useState } from 'react'
import { notify } from './../utils/notifications'
import { setProgramIds } from '../utils/ids'
import { WalletAdapter } from './wallet'
import { cache, getMultipleAccounts, MintParser } from './accounts'
import { TokenListProvider, TokenInfo } from '@solana/spl-token-registry'

import config, { ENDPOINTS, ENV } from '../config'

const DEFAULT = config.ENDPOINT.endpoint
const DEFAULT_SLIPPAGE = 0.25

interface ConnectionConfig {
  connection: Connection
  sendConnection: Connection
  endpoint: string
  slippage: number
  setSlippage: (val: number) => void
  env: ENV
  setEndpoint: (val: string) => void
  tokens: TokenInfo[]
  tokenMap: Map<string, TokenInfo>
}

const ConnectionContext = React.createContext<ConnectionConfig>({
  endpoint: DEFAULT,
  setEndpoint: () => {},
  slippage: DEFAULT_SLIPPAGE,
  setSlippage: (val: number) => {},
  connection: new Connection(DEFAULT, 'confirmed'),
  sendConnection: new Connection(DEFAULT, 'confirmed'),
  env: config.ENDPOINT.name,
  tokens: [],
  tokenMap: new Map<string, TokenInfo>(),
})

export function ConnectionProvider({ children = undefined as any }) {
  const [endpoint, setEndpoint] = useLocalStorageState(
    'connectionEndpts',
    config.ENDPOINT.endpoint
  )

  const [slippage, setSlippage] = useLocalStorageState(
    'slippage',
    DEFAULT_SLIPPAGE.toString()
  )

  const connection = useMemo(() => new Connection(endpoint, 'confirmed'), [
    endpoint,
  ])
  const sendConnection = useMemo(() => new Connection(endpoint, 'confirmed'), [
    endpoint,
  ])

  const chain =
    ENDPOINTS.find((end) => end.endpoint === endpoint) || config.ENDPOINT
  const env = chain.name

  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [tokenMap, setTokenMap] = useState<Map<string, TokenInfo>>(new Map())
  useEffect(() => {
    cache.clear()
    // fetch token files
    ;(async () => {
      const res = await new TokenListProvider().resolve()
      const list = res
        .filterByChainId(chain.chainID)
        .excludeByTag('nft')
        .getList()
      const knownMints = list.reduce((map, item) => {
        map.set(item.address, item)
        return map
      }, new Map<string, TokenInfo>())

      const accounts = await getMultipleAccounts(
        connection,
        [...knownMints.keys()],
        'single'
      )
      accounts.keys.forEach((key, index) => {
        const account = accounts.array[index]
        if (!account) {
          return
        }

        cache.add(new PublicKey(key), account, MintParser)
      })

      setTokenMap(knownMints)
      setTokens(list)
    })()
  }, [connection, chain])

  setProgramIds(env)

  // The websocket library solana/web3.js uses closes its websocket connection when the subscription list
  // is empty after opening its first time, preventing subsequent subscriptions from receiving responses.
  // This is a hack to prevent the list from every getting empty
  useEffect(() => {
    const id = connection.onAccountChange(new Account().publicKey, () => {})
    return () => {
      connection.removeAccountChangeListener(id)
    }
  }, [connection])

  useEffect(() => {
    const id = connection.onSlotChange(() => null)
    return () => {
      connection.removeSlotChangeListener(id)
    }
  }, [connection])

  useEffect(() => {
    const id = sendConnection.onAccountChange(new Account().publicKey, () => {})
    return () => {
      sendConnection.removeAccountChangeListener(id)
    }
  }, [sendConnection])

  useEffect(() => {
    const id = sendConnection.onSlotChange(() => null)
    return () => {
      sendConnection.removeSlotChangeListener(id)
    }
  }, [sendConnection])

  return (
    <ConnectionContext.Provider
      value={{
        endpoint,
        setEndpoint,
        slippage: parseFloat(slippage),
        setSlippage: (val) => setSlippage(val.toString()),
        connection,
        sendConnection,
        tokens,
        tokenMap,
        env,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  )
}

export function useConnection() {
  return useContext(ConnectionContext).connection as Connection
}

export function useSendConnection() {
  return useContext(ConnectionContext)?.sendConnection
}

export function useConnectionConfig() {
  const context = useContext(ConnectionContext)
  return {
    endpoint: context.endpoint,
    setEndpoint: context.setEndpoint,
    env: context.env,
    tokens: context.tokens,
    tokenMap: context.tokenMap,
  }
}

export function useSlippageConfig() {
  const { slippage, setSlippage } = useContext(ConnectionContext)
  return { slippage, setSlippage }
}

const getErrorForTransaction = async (connection: Connection, txid: string) => {
  // wait for all confirmation before geting transaction
  await connection.confirmTransaction(txid, 'max')

  const tx = await connection.getParsedConfirmedTransaction(txid)

  const errors: string[] = []
  if (tx?.meta && tx.meta.logMessages) {
    tx.meta.logMessages.forEach((log) => {
      const regex = /Error: (.*)/gm
      let m
      while ((m = regex.exec(log)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
          regex.lastIndex++
        }

        if (m.length > 1) {
          errors.push(m[1])
        }
      }
    })
  }

  return errors
}

export const sendTransaction = async (
  connection: Connection,
  wallet: WalletAdapter,
  instructions: TransactionInstruction[],
  signers: Account[],
  awaitConfirmation = true
) => {
  if (!wallet?.publicKey) {
    throw new Error('Wallet is not connected')
  }

  let transaction = new Transaction()
  instructions.forEach((instruction) => transaction.add(instruction))
  transaction.recentBlockhash = (
    await connection.getRecentBlockhash('max')
  ).blockhash
  transaction.setSigners(
    // fee payied by the wallet owner
    wallet.publicKey,
    ...signers.map((s) => s.publicKey)
  )
  if (signers.length > 0) {
    transaction.partialSign(...signers)
  }
  transaction = await wallet.signTransaction(transaction)
  const rawTransaction = transaction.serialize()
  let options = {
    skipPreflight: true,
    commitment: 'singleGossip',
  }

  const txid = await connection.sendRawTransaction(rawTransaction, options)

  if (awaitConfirmation) {
    const status = (
      await connection.confirmTransaction(
        txid,
        options && (options.commitment as any)
      )
    ).value

    if (status?.err) {
      const errors = await getErrorForTransaction(connection, txid)
      notify({
        message: 'Transaction failed...',
        description: (
          <>
            {errors.map((err) => (
              <div>{err}</div>
            ))}
          </>
        ),
        type: 'error',
      })

      throw new Error(
        `Raw transaction ${txid} failed (${JSON.stringify(status)})`
      )
    }
  }

  return txid
}
