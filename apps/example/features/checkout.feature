@pickle:state:active
Feature: Checkout and order completion

  @automation-exercise:14 @external-write @payment
  Scenario: Register during checkout and place an order
    Given I am on the Automation Exercise home page
    When I add the first product to the cart
    And I view the cart
    Then the cart page should be visible
    When I proceed to checkout
    And I choose to register from the checkout prompt
    And I create a disposable customer account with complete address information
    Then the navigation should show the registered customer name
    When I return to the cart and proceed to checkout
    Then the delivery address, billing address, and order summary should be visible
    When I add an order comment and place the order
    And I submit documented practice payment data
    Then the successful order confirmation should be visible
    When I delete the account
    Then "ACCOUNT DELETED!" should be visible

  @automation-exercise:15 @external-write @payment
  Scenario: Register before checkout and place an order
    Given I am on the Automation Exercise home page
    When I create a disposable customer account with complete address information
    Then the navigation should show the registered customer name
    When I add the first product to the cart
    And I view the cart
    Then the cart page should be visible
    When I proceed to checkout
    Then the delivery address, billing address, and order summary should be visible
    When I add an order comment and place the order
    And I submit documented practice payment data
    Then the successful order confirmation should be visible
    When I delete the account
    Then "ACCOUNT DELETED!" should be visible

  @automation-exercise:16 @external-write @payment @requires-account
  Scenario: Sign in before checkout and place an order
    Given a disposable registered customer account is available
    And I am on the Automation Exercise home page
    When I sign in with the disposable account email and password
    Then the navigation should show the signed-in customer name
    When I add the first product to the cart
    And I view the cart
    Then the cart page should be visible
    When I proceed to checkout
    Then the delivery address, billing address, and order summary should be visible
    When I add an order comment and place the order
    And I submit documented practice payment data
    Then the successful order confirmation should be visible
    When I delete the account
    Then "ACCOUNT DELETED!" should be visible

  @automation-exercise:23 @external-write
  Scenario: Use the registered address at checkout
    Given I am on the Automation Exercise home page
    When I create a disposable customer account with complete address information
    Then the navigation should show the registered customer name
    When I add the first product to the cart
    And I view the cart
    And I proceed to checkout
    Then the delivery address should match the registered address
    And the billing address should match the registered address
    When I delete the account
    Then "ACCOUNT DELETED!" should be visible

  @automation-exercise:24 @external-write @payment @downloads-file
  Scenario: Download the invoice after placing an order
    Given I am on the Automation Exercise home page
    When I add the first product to the cart
    And I view the cart
    And I proceed to checkout
    And I choose to register from the checkout prompt
    And I create a disposable customer account with complete address information
    Then the navigation should show the registered customer name
    When I return to the cart and proceed to checkout
    Then the delivery address, billing address, and order summary should be visible
    When I add an order comment and place the order
    And I submit documented practice payment data
    Then the successful order confirmation should be visible
    When I download the invoice
    Then an invoice file should be downloaded
    When I continue and delete the account
    Then "ACCOUNT DELETED!" should be visible
