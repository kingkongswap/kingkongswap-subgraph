/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts/index'
import { Bundle, Pair, Token } from '../types/schema'
import { ADDRESS_ZERO, factoryContract, ONE_BD, ZERO_BD } from './helpers'

const WOKT_ADDRESS = '0x70c1c53e991f31981d592c2d865383ac0d212225'

// usdc-wokt
const USDC_WOKT_PAIR = '0x4a8123ac977380198241e9edc64a986e483ba75d' // created -

// usdk-wokt
const USDK_WOKT_PAIR = '0xc3a9967c7ab0a4312e225feef19103168995643d' // created block -

// wokt-usdt
const USDT_WOKT_PAIR = '0x695ef962b4ee88ed193148e486208d58d184d203' // created block -

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdkPair = Pair.load(USDK_WOKT_PAIR) // usdk is token0
  let usdcPair = Pair.load(USDC_WOKT_PAIR) // usdc is token0
  let usdtPair = Pair.load(USDT_WOKT_PAIR) // usdt is token1

  // all 3 have been created
  if (usdkPair !== null && usdcPair !== null && usdtPair !== null) {
    let totalLiquidityETH = usdkPair.reserve1.plus(usdcPair.reserve1).plus(usdtPair.reserve0)
    let usdkWeight = usdkPair.reserve1.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve1.div(totalLiquidityETH)
    let usdtWeight = usdtPair.reserve0.div(totalLiquidityETH)
    return usdkPair.token0Price
      .times(usdkWeight)
      .plus(usdcPair.token0Price.times(usdcWeight))
      .plus(usdtPair.token1Price.times(usdtWeight))
    // USDK and USDT have been created
  } else if (usdkPair !== null && usdtPair !== null) {
    let totalLiquidityETH = usdkPair.reserve1.plus(usdtPair.reserve0)
    let usdkWeight = usdkPair.reserve1.div(totalLiquidityETH)
    let usdcWeight = usdtPair.reserve0.div(totalLiquidityETH)
    return usdkPair.token0Price.times(usdkWeight).plus(usdtPair.token1Price.times(usdcWeight))
    // USDT is the only pair so far
  } else if (usdtPair !== null) {
    return usdtPair.token1Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0x70c1c53e991f31981d592c2d865383ac0d212225', // WOKT
  '0x533367b864d9b9aa59d0dcb6554df0c89feef1ff', // USDK
  '0x3e33590013b24bf21d4ccca3a965ea10e570d5b2', // USDC
  '0xe579156f9decc4134b5e3a30a24ac46bb8b01281', // USDT
  '0x09973e7e3914eb5ba69c7c025f30ab9446e3e4e0', // BTCK
  '0xdf950cecf33e64176ada5dd733e170a56d11478e', // ETHK
  '0x72f8fa5da80dc6e20e00d02724cf05ebd302c35f', // DOTK
  '0xf6a0dc1fd1d2c0122ab075d7ef93ad79f02ccb93', // FILK
  '0xd616388f6533b6f1c31968a305fbee1727f55850', // LTCK
  '0x4888097d1b29b439c55c6d3e44031ee658237de3', // KKT
  '0x6fd9db63dbc6be452ae7b0fe9995c81d967870bb', // NAS
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('1')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('1')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WOKT_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(1))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
