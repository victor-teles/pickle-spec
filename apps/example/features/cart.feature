@pickle:state:active
Feature: Shopping cart

  @automation-exercise:12
  Scenario: Add multiple products to the cart
    Given I am on the Automation Exercise home page
    When I navigate to /products
    And I add the first product to the cart
    And I continue shopping
    And I add the second product to the cart
    And I view the cart
    Then both products should be in the cart
    And each product should show its price, quantity, and total

  @automation-exercise:13
  Scenario: Preserve a selected product quantity in the cart
    Given I am on the Automation Exercise home page
    When I view the first product
    And I set its quantity to 4
    And I add it to the cart
    And I view the cart
    Then the product quantity should be 4

  @automation-exercise:17
  Scenario: Remove a product from the cart
    Given I am on the Automation Exercise home page
    When I add the first product to the cart
    And I view the cart
    Then the product should be in the cart
    When I remove the product
    Then the product should no longer be in the cart

  @automation-exercise:20 @requires-account
  Scenario: Keep searched products in the cart after sign-in
    Given a disposable registered customer account is available
    And I am on the Automation Exercise home page
    When I navigate to /products
    And I enter "Top" in the "Search Product" field
    And I click the product search button
    Then "SEARCHED PRODUCTS" should be visible
    When I add every visible search result to the cart
    And I view the cart
    Then every selected product should be in the cart
    When I sign in with the disposable account email and password
    And I return to the cart
    Then every selected product should still be in the cart

  @automation-exercise:22
  Scenario: Add a recommended product to the cart
    Given I am on the Automation Exercise home page
    When I scroll to "RECOMMENDED ITEMS"
    And I add the first recommended product to the cart
    And I view the cart
    Then the recommended product should be in the cart
