const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")


const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const assertRevert = th.assertRevert
const toBN = th.toBN
const dec = th.dec

contract('Deploying the SABLE contracts: LCF, CI, SABLEStaking, and SABLEToken ', async accounts => {
  const [liquityAG, A, B] = accounts;
  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let SABLEContracts

  const oneMillion = toBN(1000000)
  const digits = toBN(1e18)
  const thirtyTwo = toBN(32)
  const expectedCISupplyCap = thirtyTwo.mul(oneMillion).mul(digits)

  beforeEach(async () => {
    // Deploy all contracts from the first account
    SABLEContracts = await deploymentHelper.deploySABLEContracts(bountyAddress, oneMillion)
    

    sableStaking = SABLEContracts.sableStaking
    sableToken = SABLEContracts.sableToken
    communityIssuance = SABLEContracts.communityIssuance

    //SABLE Staking and CommunityIssuance have not yet had their setters called, so are not yet
    // connected to the rest of the system
  })


  describe('CommunityIssuance deployment', async accounts => {
    it("Stores the deployer's address", async () => {
      const storedDeployerAddress = await communityIssuance.owner()

      assert.equal(liquityAG, storedDeployerAddress)
    })
  })

  describe('SABLEStaking deployment', async accounts => {
    it("Stores the deployer's address", async () => {
      const storedDeployerAddress = await sableStaking.owner()

      assert.equal(liquityAG, storedDeployerAddress)
    })
  })
})
