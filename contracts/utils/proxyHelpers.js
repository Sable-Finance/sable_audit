const { TestHelper: th } = require("../utils/testHelpers.js")
const { Interface } = require("@ethersproject/abi");

const DSProxyFactory = artifacts.require('DSProxyFactory')
const DSProxy = artifacts.require('DSProxy')
const testHelpers = require("../utils/testHelpers.js")
const DEFAULT_PRICE_FEED_DATA = testHelpers.DEFAULT_PRICE_FEED_DATA

const buildUserProxies = async (users) => {
  const proxies = {}
  const proxyFactory = await DSProxyFactory.new()
  for(let user of users) {
    const proxyTx = await proxyFactory.build({ from: user })
    proxies[user] = await DSProxy.at(proxyTx.logs[0].args.proxy)
  }

  return proxies
}

class Proxy {
  constructor (owner, proxies, scriptAddress, contract) {
    this.owner = owner
    this.proxies = proxies
    this.scriptAddress = scriptAddress
    this.contract = contract
    if (contract) this.address = contract.address
  }

  getFrom(params) {
    if (params.length == 0) return this.owner
    let lastParam = params[params.length - 1]
    if (lastParam.from) {
      return lastParam.from
    }

    return this.owner
  }

  getOptionalParams(params) {
    if (params.length == 0) return {}

    return params[params.length - 1]
  }

  getProxyAddressFromUser(user) {
    return this.proxies[user] ? this.proxies[user].address : user
  }

  getProxyFromUser(user) {
    return this.proxies[user]
  }

  getProxyFromParams(params) {
    const user = this.getFrom(params)
    return this.proxies[user]
  }

  getSlicedParams(params) {
    if (params.length == 0) return params
    let lastParam = params[params.length - 1]
    if (lastParam.from || lastParam.value) {
      return params.slice(0, -1)
    }

    return params
  }

  async forwardFunction(params, signature) {
    const proxy = this.getProxyFromParams(params)
    if (!proxy) {
      return this.proxyFunction(signature.slice(0, signature.indexOf('(')), params)
    }
    const optionalParams = this.getOptionalParams(params)
    // const calldata = th.getTransactionData(signature, this.getSlicedParams(params))
    const iface = new Interface([`function ${signature}`]);
    let encodeParams;
    if (optionalParams) {
      encodeParams = params.slice(0, params.length-1);
    } else {
      encodeParams = params;
    }
    for (let i = 0; i < encodeParams.length-1; i++) {
      if (typeof encodeParams[i] == 'object') {
        encodeParams[i] = web3.utils.toHex(encodeParams[i])
      }
    }
    const calldata = iface.encodeFunctionData(signature.slice(0, signature.indexOf('(')), encodeParams);

    // console.log('proxy: ', proxy.address)
    // console.log(this.scriptAddress, calldata, optionalParams)
    return proxy.methods["execute(address,bytes)"](this.scriptAddress, calldata, optionalParams)
  }

  async proxyFunctionWithUser(functionName, user) {
    return this.contract[functionName](this.getProxyAddressFromUser(user), DEFAULT_PRICE_FEED_DATA)
  }

  async proxyFunction(functionName, params) {
    // console.log('contract: ', this.contract.address)
    // console.log('functionName: ', functionName)
    // console.log('params: ', params)
    return this.contract[functionName](...params)
  }
}

class BorrowerOperationsProxy extends Proxy {
  constructor(owner, proxies, borrowerOperationsScriptAddress, borrowerOperations) {
    super(owner, proxies, borrowerOperationsScriptAddress, borrowerOperations)
  }

  async openTrove(...params) {
    return this.forwardFunction(params, 'openTrove(uint256,uint256,address,address,bytes[])')
  }

  async addColl(...params) {
    return this.forwardFunction(params, 'addColl(address,address,bytes[])')
  }

  async withdrawColl(...params) {
    return this.forwardFunction(params, 'withdrawColl(uint256,address,address,bytes[])')
  }

  async withdrawUSDS(...params) {
    return this.forwardFunction(params, 'withdrawUSDS(uint256,uint256,address,address,bytes[])')
  }

  async repayUSDS(...params) {
    return this.forwardFunction(params, 'repayUSDS(uint256,address,address,bytes[])')
  }

  async closeTrove(...params) {
    return this.forwardFunction(params, 'closeTrove(bytes[])')
  }

  async adjustTrove(...params) {
    return this.forwardFunction(params, 'adjustTrove(uint256,uint256,uint256,bool,address,address,bytes[])')
  }

  async claimRedeemedCollateral(...params) {
    return this.forwardFunction(params, 'claimRedeemedCollateral(address,bytes[])')
  }

  async getNewTCRFromTroveChange(...params) {
    return this.proxyFunction('getNewTCRFromTroveChange', params)
  }

  async getNewICRFromTroveChange(...params) {
    return this.proxyFunction('getNewICRFromTroveChange', params)
  }

  async getCompositeDebt(...params) {
    return this.proxyFunction('getCompositeDebt', params)
  }

  async USDS_GAS_COMPENSATION(...params) {
    return this.proxyFunction('USDS_GAS_COMPENSATION', params)
  }

  async MIN_NET_DEBT(...params) {
    return this.proxyFunction('MIN_NET_DEBT', params)
  }

  async BORROWING_FEE_FLOOR(...params) {
    return this.proxyFunction('BORROWING_FEE_FLOOR', params)
  }
}

class BorrowerWrappersProxy extends Proxy {
  constructor(owner, proxies, borrowerWrappersScriptAddress) {
    super(owner, proxies, borrowerWrappersScriptAddress, null)
  }

  async claimCollateralAndOpenTrove(...params) {
    return this.forwardFunction(params, 'claimCollateralAndOpenTrove(uint256,uint256,address,address,bytes[])')
  }

  async claimSPRewardsAndRecycle(...params) {
    return this.forwardFunction(params, 'claimSPRewardsAndRecycle(uint256,address,address,bytes[])')
  }

  async claimStakingGainsAndRecycle(...params) {
    return this.forwardFunction(params, 'claimStakingGainsAndRecycle(uint256,address,address,bytes[])')
  }

  async transferBNB(...params) {
    return this.forwardFunction(params, 'transferBNB(address,uint256)')
  }
}

class TroveManagerProxy extends Proxy {
  constructor(owner, proxies, troveManagerScriptAddress, troveManager) {
    super(owner, proxies, troveManagerScriptAddress, troveManager)
  }

  async Troves(user) {
    return this.proxyFunctionWithUser('Troves', user)
  }

  async getTroveStatus(user) {
    return this.proxyFunctionWithUser('getTroveStatus', user)
  }

  async getTroveDebt(user) {
    return this.proxyFunctionWithUser('getTroveDebt', user)
  }

  async getTroveColl(user) {
    return this.proxyFunctionWithUser('getTroveColl', user)
  }

  async totalStakes() {
    return this.proxyFunction('totalStakes', [])
  }

  async getPendingBNBReward(...params) {
    return this.proxyFunction('getPendingBNBReward', params)
  }

  async getPendingUSDSDebtReward(...params) {
    return this.proxyFunction('getPendingUSDSDebtReward', params)
  }

  async liquidate(user) {
    return this.proxyFunctionWithUser('liquidate', user)
  }

  async getTCR(...params) {
    return this.proxyFunction('getTCR', params)
  }

  async getCurrentICR(user, price) {
    return this.contract.getCurrentICR(this.getProxyAddressFromUser(user), price)
  }

  async checkRecoveryMode(...params) {
    return this.proxyFunction('checkRecoveryMode', params)
  }

  async getTroveOwnersCount() {
    return this.proxyFunction('getTroveOwnersCount', [])
  }

  async baseRate() {
    return this.proxyFunction('baseRate', [])
  }

  async L_BNB() {
    return this.proxyFunction('L_BNB', [])
  }

  async L_USDSDebt() {
    return this.proxyFunction('L_USDSDebt', [])
  }

  async rewardSnapshots(user) {
    return this.proxyFunctionWithUser('rewardSnapshots', user)
  }

  async lastFeeOperationTime() {
    return this.proxyFunction('lastFeeOperationTime', [])
  }

  async redeemCollateral(...params) {
    return this.forwardFunction(params, 'redeemCollateral(uint256,address,address,address,uint256,uint256,uint256,bytes[])')
  }

  async getActualDebtFromComposite(...params) {
    return this.proxyFunction('getActualDebtFromComposite', params)
  }

  async getRedemptionFeeWithDecay(...params) {
    return this.proxyFunction('getRedemptionFeeWithDecay', params)
  }

  // async getBorrowingRate() {
  //   return this.proxyFunction('getBorrowingRate', [])
  // }
  async getBorrowingRate(...params) {
    return this.proxyFunction('getBorrowingRate', params)
  }

  // async getBorrowingRateWithDecay() {
  //   return this.proxyFunction('getBorrowingRateWithDecay', [])
  // }
  async getBorrowingRateWithDecay(...params) {
    return this.proxyFunction('getBorrowingRateWithDecay', params)
  }

  async getBorrowingFee(...params) {
    return this.proxyFunction('getBorrowingFee', params)
  }

  async getBorrowingFeeWithDecay(...params) {
    return this.proxyFunction('getBorrowingFeeWithDecay', params)
  }

  async getEntireDebtAndColl(...params) {
    return this.proxyFunction('getEntireDebtAndColl', params)
  }
}

class StabilityPoolProxy extends Proxy {
  constructor(owner, proxies, stabilityPoolScriptAddress, stabilityPool) {
    super(owner, proxies, stabilityPoolScriptAddress, stabilityPool)
  }

  async provideToSP(...params) {
    return this.forwardFunction(params, 'provideToSP(uint256,address)')
  }

  async getCompoundedUSDSDeposit(user) {
    return this.proxyFunctionWithUser('getCompoundedUSDSDeposit', user)
  }

  async deposits(user) {
    return this.proxyFunctionWithUser('deposits', user)
  }

  async getDepositorBNBGain(user) {
    return this.proxyFunctionWithUser('getDepositorBNBGain', user)
  }
}

class SortedTrovesProxy extends Proxy {
  constructor(owner, proxies, sortedTroves) {
    super(owner, proxies, null, sortedTroves)
  }

  async contains(user) {
    return this.proxyFunctionWithUser('contains', user)
  }

  async isEmpty(user) {
    return this.proxyFunctionWithUser('isEmpty', user)
  }

  async findInsertPosition(...params) {
    return this.proxyFunction('findInsertPosition', params)
  }
}

class TokenProxy extends Proxy {
  constructor(owner, proxies, tokenScriptAddress, token) {
    super(owner, proxies, tokenScriptAddress, token)
  }

  async transfer(...params) {
    // switch destination to proxy if any
    params[0] = this.getProxyAddressFromUser(params[0])
    return this.forwardFunction(params, 'transfer(address,uint256)')
  }

  async transferFrom(...params) {
    // switch to proxies if any
    params[0] = this.getProxyAddressFromUser(params[0])
    params[1] = this.getProxyAddressFromUser(params[1])
    return this.forwardFunction(params, 'transferFrom(address,address,uint256)')
  }

  async approve(...params) {
    // switch destination to proxy if any
    params[0] = this.getProxyAddressFromUser(params[0])
    return this.forwardFunction(params, 'approve(address,uint256)')
  }

  async increaseAllowance(...params) {
    // switch destination to proxy if any
    params[0] = this.getProxyAddressFromUser(params[0])
    return this.forwardFunction(params, 'increaseAllowance(address,uint256)')
  }

  async decreaseAllowance(...params) {
    // switch destination to proxy if any
    params[0] = this.getProxyAddressFromUser(params[0])
    return this.forwardFunction(params, 'decreaseAllowance(address,uint256)')
  }

  async totalSupply(...params) {
    return this.proxyFunction('totalSupply', params)
  }

  async balanceOf(user) {
    return this.proxyFunctionWithUser('balanceOf', user)
  }

  async allowance(...params) {
    // switch to proxies if any
    const owner = this.getProxyAddressFromUser(params[0])
    const spender = this.getProxyAddressFromUser(params[1])

    return this.proxyFunction('allowance', [owner, spender])
  }

  async name(...params) {
    return this.proxyFunction('name', params)
  }

  async symbol(...params) {
    return this.proxyFunction('symbol', params)
  }

  async decimals(...params) {
    return this.proxyFunction('decimals', params)
  }
}

class SableStakingV2Proxy extends Proxy {
  constructor(owner, proxies, tokenScriptAddress, token) {
    super(owner, proxies, tokenScriptAddress, token)
  }

  async stake(...params) {
    return this.forwardFunction(params, 'stake(uint256)')
  }

  async setSableLPAddress(...params) {
    return this.forwardFunction(params, 'setSableLPAddress(address)')
  }

  async stakes(user) {
    return this.proxyFunctionWithUser('stakes', user)
  }

  async F_USDS(user) {
    return this.proxyFunctionWithUser('F_USDS', user)
  }
}

module.exports = {
  buildUserProxies,
  BorrowerOperationsProxy,
  BorrowerWrappersProxy,
  TroveManagerProxy,
  StabilityPoolProxy,
  SortedTrovesProxy,
  TokenProxy,
  SableStakingV2Proxy
}
