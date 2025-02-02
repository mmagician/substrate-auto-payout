/**
 * autopayout-validators.js
 *  
 * Claim and distribute validator staking rewards for your stakers
 * 
 * Accepts several validators in config.js file
 *
 * https://github.com/Colm3na/polkadot-auto-payout
 * 
 * Author: Mario Pino | @mariopino:matrix.org
 */

const BigNumber = require('bignumber.js');
const { ApiPromise, WsProvider } = require('@polkadot/api');
const keyring = require('@polkadot/ui-keyring').default;
keyring.initKeyring({
  isDevelopment: false,
});
const fs = require('fs');
const prompts = require('prompts');
const yargs = require('yargs');
const config = require('./config.js');

const argv = yargs
  .scriptName("autopayout.js")
  .option('account', {
    alias: 'a',
    description: 'Account json file path',
    type: 'string',
  })
  .option('password', {
      alias: 'p',
      description: 'Account password, or stdin if this is not set',
      type: 'string',
  })
  .option('validator', {
      alias: 'v',
      description: 'Validator address',
      type: 'array',
   })
  .option('log', {
    alias: 'l',
    description: 'log (append) to autopayout.log file',
    type: 'boolean',
  })
  .usage("node autopayout.js -c keystores/account.json -p password -v validator_stash_address")
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'V')
  .argv;

// Exported account json file param
const accountJSON = argv.account || config.accountJSON;

// Password param
let password = argv.password || config.password;

// Logging to file param
const log = argv.log || config.log;

// Node websocket
const wsProvider = config.nodeWS;

// List of validators
const validators = argv.validator || config.validators;

const main = async () => {

  console.log("\n\x1b[45m\x1b[1m Substrate auto payout \x1b[0m\n");
  console.log("\x1b[1m - Check source at https://github.com/Colm3na/substrate-auto-payout\x1b[0m");
  console.log("\x1b[32m\x1b[1m - Made with love from ColmenaLabs_SVQ https://colmenalabs.org/\x1b[0m\n");

  let raw;
  try {
    raw = fs.readFileSync(accountJSON, { encoding: 'utf-8' });
  } catch(err) {
    console.log(`\x1b[31m\x1b[1mError! Can't open ${accountJSON}\x1b[0m\n`);
    process.exit(1);
  }

  const account = JSON.parse(raw);
  const address = account.address;
  
  // Prompt user to enter password
  if (!password) {
    const response = await prompts({
      type: 'password',
      name: 'password',
      message: `Enter password for ${address}:`
    });
    password = response.password;
  }

  if (password) {
    console.log(`\x1b[1m -> Importing account\x1b[0m`, address);
    const signer = keyring.restoreAccount(account, password); 
    signer.decodePkcs8(password);

    // Connect to node
    console.log(`\x1b[1m -> Connecting to\x1b[0m`, wsProvider);
    const provider = new WsProvider(wsProvider);
    const api = await ApiPromise.create({ provider });

    // Check account balance
    const accountBalance = await api.derive.balances.all(address);
    const availableBalance = accountBalance.availableBalance;
    if (availableBalance.eq(0)) {
      console.log(`\x1b[31m\x1b[1mError! Account ${address} doesn't have available funds\x1b[0m\n`);
      process.exit(1);
    }
    console.log(`\x1b[1m -> Account ${address} available balance is ${availableBalance.toHuman()}\x1b[0m`);

    // Get session progress info
    const chainActiveEra = await api.query.staking.activeEra();
    const activeEra = JSON.parse(JSON.stringify(chainActiveEra)).index;
    console.log(`\x1b[1m -> Active era is ${activeEra}\x1b[0m`);

    let transactions = [];

    for (let index = 0; index < validators.length; index++) {
      const validator = validators[index];
      let unclaimedRewards = [];
      let era = activeEra - 84;
      const stakingInfo = await api.derive.staking.account(validator);
      const claimedRewards = stakingInfo.stakingLedger.claimedRewards;
      console.log(`\x1b[1m -> Claimed eras for validator ${validator}: ${JSON.stringify(claimedRewards)}\x1b[0m`);
      for (era; era < activeEra; era++) {
        const eraPoints = await api.query.staking.erasRewardPoints(era);
        const eraValidators = Object.keys(eraPoints.individual.toHuman());
        if (eraValidators.includes(validator) && !claimedRewards.includes(era)) {
          transactions.push(api.tx.staking.payoutStakers(validator, era));
          unclaimedRewards.push(era);
        }
      }
      console.log(`\x1b[1m -> Unclaimed eras for validator ${validator}: ${JSON.stringify(unclaimedRewards)}\x1b[0m`);
    }

    if (transactions.length > 0) {
      // Claim rewards tx
      const nonce = (await api.derive.balances.account(address)).accountNonce
      const hash = await api.tx.utility.batch(transactions).signAndSend(signer, { nonce });
      console.log(`\n\x1b[32m\x1b[1mSuccess! \x1b[37mCheck tx in PolkaScan: https://polkascan.io/kusama/transaction/${hash.toString()}\x1b[0m\n`);
      if (log) {
        fs.appendFileSync(`autopayout.log`, `${new Date()} - Claimed rewards, transaction hash is ${hash.toString()}\n`);
      }
    } else {
      console.log(`\n\x1b[33m\x1b[1mWarning! There's no unclaimed rewards, exiting!\x1b[0m\n`);
      if (log) {
        fs.appendFileSync(`autopayout.log`, `${new Date()} - There's no unclaimed rewards\n`);
      }
    }
    process.exit(0);
  }
}

try {
  main();
} catch (error) {
  console.error(error);
}
