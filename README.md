# PolyVault

A smart contract vault for pooling capital to trade on Polymarket prediction markets. The vault operates in three distinct phases:

## Phases

### CAPITAL_FORMATION
- Users deposit USDC into the vault
- Entry fees are collected and sent to manager
- Early withdrawals permitted
- Total deposited amount is tracked

### MARKET_TRADING  
- Manager executes trades on Polymarket via signatures
- No deposits or withdrawals allowed
- CTF positions tracked automatically
- Trading restricted to manager address

### REDEMPTION
- Trading no longer permitted
- Users can withdraw their share of the vault
- Manager receives profit share if profitable
- Final accounting and distributions occur

## Key Features

- ERC4626 compliant vault with fee structure
- Entry fees capped at 2%
- Manager profit share capped at 30%
- Automated position tracking for Polymarket CTF tokens
- Time-bound phases with clear transitions
- Signature-based trading permissions

## Technical Implementation

The vault inherits from:
- ERC4626Fees for standardized vault functionality
- ERC1155Holder for receiving Polymarket positions

Key integrations:
- USDC as the deposit token
- Polymarket CTF contract for positions
- Polymarket Exchange for trading

## Usage Flow

1. Deploy vault with:
   - Manager address
   - Fee settings
   - Phase timeframes
   - Token addresses

2. Users deposit during CAPITAL_FORMATION

3. Manager trades during MARKET_TRADING

4. Users withdraw during REDEMPTION

The vault provides a structured way to pool capital for professional trading on Polymarket while ensuring fair profit distribution and fee collection.

