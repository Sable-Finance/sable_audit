import numpy as np
import matplotlib.pyplot as plt



# model parameters
class ModelParams:
    def __init__(self):
        self.D = 0.1 # base fee decay factor
        
        self.A = 1.5 # weighting for price change in token demand
        self.B = 1.5 # weighting for momentum change in token demand
       
        self.T = 5 # weighting for price change in trove issuance
        self.F = 5 # weighting for momentum change in trove issuance

        self.lookback = 5 # Lookback parameter for BNB price momentum

        self.max_redemption_fraction = 0.5 # Maximum fraction of supply that can be redeemed in a timestep

# time series data 
class Data:
    def __init__(self):
        self.BNB_price = [500.0]
        self.momentum = [0.0]
        self.base_fee = [0.0]
        self.redeemed_amount = [0.0]
        self.token_price = [1.0]
        self.token_demand = [100.0]
        self.trove_issuance = [100.0]
        self.token_supply = [100.0]
        self.innate_token_demand = 100.0
  
        
### Functions
def get_new_momentum(data, params, BNB_price):
    lookback = params.lookback
    if lookback == 0:
        return 0

    BNB_price_past = get_past_BNB_price(data, params)

    new_momentum = (BNB_price - BNB_price_past) /  BNB_price_past
    return new_momentum

def get_past_BNB_price(data, params):
    length = len(data.BNB_price)
    
    BNB_price_past = None
    if (params.lookback > length):
        BNB_price_past = data.BNB_price[0]
    else:
        BNB_price_past = data.BNB_price[length - params.lookback - 1]

    if BNB_price_past == 0:
        return 1
    return BNB_price_past

def get_new_redeemed_amount(data, params):
    max_redeemable  = data.token_supply[-1] * params.max_redemption_fraction 
    if max_redeemable == 0:
        return 0

    redeemed = (1 - data.token_price[-1] - data.base_fee[-1]) * data.token_supply[-1] / 2

    if redeemed < 0:
        return 0
    else:
        return max(redeemed, max_redeemable)

# Decay base fee correctly
def get_new_base_fee(data, redeemed_amount):
    if data.token_supply[-1] == 0:
        return 0

    base_fee = data.base_fee[-1]*params.D + (redeemed_amount / (2 * data.token_supply[-1]))
    return base_fee

# return the innate component of market demand for holding SABLE tokens.  Could be a function of:
# - demand for a safe-haven $1-pegged asset  
# - trader needs for liquidity
# - 
def get_innate_token_demand():
    return 100.0

# compute price based on setting token supply = trove demand, and clearing the market
def get_new_token_price(data, params, redeemed_amount, momentum):
    B = params.B
    F = params.F
    A = params.A
    T = params.T

    factor = - 1 /(A + T)
    print(f'factor: {factor}')
    # price = (data.trove_issuance[-1] - data.token_demand[-1] - ((A + T) * data.token_price[-1]) + ((B + F) * momentum) - redeemed_amount) * factor 
    price = (data.trove_issuance[-1] - data.innate_token_demand - (A * data.token_price[-1] )  -T + ((B + F) * momentum) - redeemed_amount) * factor 

    if price < 0:
        return 0
    elif price > 1.1:
        return 1.1
    else:
        return price
    # return price

def get_new_token_demand(data, params, token_price, momentum):
    demand = data.innate_token_demand - params.A*(token_price - data.token_price[-1]) - params.B*(momentum)
    if demand < 0:
        return 0
    else: 
        return demand

def get_new_trove_issuance(data, params, token_price, momentum ):
    trove_issuance = data.trove_issuance[-1] + params.T*(token_price - 1) + params.F*(momentum)
    if trove_issuance < 0:
        return 0
    else: 
        return trove_issuance

def get_new_token_supply(trove_issuance, redeemed):
    new_supply =  trove_issuance - redeemed

    if new_supply < 0:
        return 0
    else: 
        return new_supply
  
### Various BNB price functions

def constant_BNB_price(last_price):
    return last_price

# BNB price generator is a random walk (normal dist.), with occasional large +ve and -ve jumps
def randomwalk_BNB_price(last_price):
    big_event = 0
    big_event_chance = np.random.normal()

    if (big_event_chance > 1.5) or (big_event_chance < -1.5):
        big_event = big_event_chance * 20
 
    new_price  = last_price + np.random.normal(scale=5) + big_event
    
    if new_price < 0: 
        return 0
    else:
        return new_price

def linear_increasing_BNB_price(last_price, gradient):
    return last_price + gradient

def oscillating_BNB_price(min, magnitude, i):
    return min + magnitude + magnitude*np.sin(i)

def linear_decreasing_BNB_price(last_price, gradient):
    return last_price - gradient

def quadratic_BNB_price(scale, i):
    return scale*(i**2)

def sublinear_BNB_price(last_price, steepness, i):
    return last_price + 1/(2*np.sqrt(steepness*(i+1)))
    

# ### Script

params = ModelParams() 
data = Data() # initialize data timeseries

for i in range(1, 100):
    # update exogenous BNB price
    last_BNB_price =  data.BNB_price[-1]

    # BNB_price = last_BNB_price
    # BNB_price = randomwalk_BNB_price(last_BNB_price)
    # BNB_price = oscillating_BNB_price(500, 10, i)
    # BNB_price = quadratic_BNB_price(10, i)
    # BNB_price = linear_increasing_BNB_price(last_BNB_price, 100)
    # BNB_price = linear_decreasing_BNB_price(last_BNB_price, 1)
    BNB_price = sublinear_BNB_price(last_BNB_price, 10, i)
    
    # print(BNB_price)

    momentum = get_new_momentum(data, params, BNB_price)
    redeemed_amount = get_new_redeemed_amount(data, params)
    base_fee = get_new_base_fee(data, redeemed_amount)

    data.innate_token_demand = get_innate_token_demand()

    # clear the market
    token_price = get_new_token_price(data, params, redeemed_amount, momentum)

    token_demand = get_new_token_demand(data, params, token_price, momentum)
    trove_issuance = get_new_trove_issuance(data, params, token_price, momentum)
    token_supply = get_new_token_supply(trove_issuance, redeemed_amount)
    
    # display all new data
    print(f'step: {i}')
    print(f'BNB price: {BNB_price}')
    print(f'momentum: {momentum}')
    print(f'redeemed amount: {redeemed_amount}')
    print(f'base fee: {base_fee}')
    print(f'token price: {token_price}')
    print(f'token demand: {token_demand}')
    print(f'trove_issuance: {trove_issuance}')
    print(f'token_supply: {token_supply}')

    # update all time series
    data.BNB_price.append(BNB_price)
    data.momentum.append(momentum)
    data.redeemed_amount.append(redeemed_amount)
    data.base_fee.append(base_fee)
    data.token_price.append(token_price)
    data.token_demand.append(token_demand)
    data.trove_issuance.append(trove_issuance)
    data.token_supply.append(token_supply)

# print(f'length redeemed amt is  + {len(data.redeemed_amount)}')
# print(*data.redeemed_amount)
# print(*data.base_fee)
# print(*data.token_price)
# print(*data.momentum)

# Plot results

fig = plt.figure()
ax1 = fig.add_subplot(221)
ax1.set_title('Token price')
plt.plot(data.token_price)

ax2 = fig.add_subplot(222)
ax2.set_title('Redeemed amount')
plt.plot(data.redeemed_amount)

ax3 = fig.add_subplot(223)
ax3.set_title('BNB Price')
plt.plot(data.BNB_price)

ax4 = fig.add_subplot(224)
ax4.set_title('Base Fee')
plt.plot(data.base_fee)


# plt.plot(data.momentum)
# plt.plot(data.token_demand)


plt.show()