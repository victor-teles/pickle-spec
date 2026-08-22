@pickle:state:active
Feature: Product catalog

  @regression
  Scenario: Standard customer sees the complete inventory
    Given I am on the SauceDemo login page
    When I sign in with "standard_user" and "secret_sauce"
    Then the "Products" page should show 6 products
    And the product inventory should contain:
      | name                                  |
      | Sauce Labs Backpack                   |
      | Sauce Labs Bike Light                 |
      | Sauce Labs Bolt T-Shirt               |
      | Sauce Labs Fleece Jacket              |
      | Sauce Labs Onesie                      |
      | Test.allTheThings() T-Shirt (Red)      |

  @regression
  Scenario: Customer sorts products from lowest to highest price
    Given I am on the SauceDemo login page
    When I sign in with "standard_user" and "secret_sauce"
    And I sort products by "Price (low to high)"
    Then the displayed product prices should be ordered as:
      | price  |
      | $7.99  |
      | $9.99  |
      | $15.99 |
      | $15.99 |
      | $29.99 |
      | $49.99 |

  @regression
  Scenario: Customer views the backpack details
    Given I am on the SauceDemo login page
    When I sign in with "standard_user" and "secret_sauce"
    And I select the "Sauce Labs Backpack" product name
    Then the product detail page should show "Sauce Labs Backpack"
    And the product description and "$29.99" price should be visible
    And "Back to products" and "Add to cart" should be visible
