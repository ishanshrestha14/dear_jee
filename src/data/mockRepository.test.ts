import { createMockRepositories, MOCK_USER_ID, MOCK_PARTNER_ID } from './mockRepository'
import { describeRepositoryContract, type ContractFixture } from './contractTests'

function fixture(options: { unlinked?: boolean } = {}): ContractFixture {
  const repos = createMockRepositories(options)
  return {
    letters: repos.letters,
    profiles: repos.profiles,
    userId: MOCK_USER_ID,
    partnerId: MOCK_PARTNER_ID,
    unlinked: async () => fixture({ unlinked: true }),
  }
}

describeRepositoryContract('mockRepository', async () => fixture())
