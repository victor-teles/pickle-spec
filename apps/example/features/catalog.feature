@pickle:state:active
Feature: Product catalog

  @automation-exercise:7 @smoke @read-only
  Scenario: View the published test-case catalog
    Given I am on the Automation Exercise home page
    When I click the "Test Cases" link whose destination is "/test_cases"
    Then the test-case catalog should be visible
    And the catalog should contain test cases 1 through 26

  @automation-exercise:8 @smoke @read-only
  Scenario: View all products and a product detail page
    Given I am on the Automation Exercise home page
    When I navigate to /products
    Then "ALL PRODUCTS" should be visible
    And the product list should not be empty
    When I view the first product
    Then its name, category, price, availability, condition, and brand should be visible

  @automation-exercise:9 @smoke @read-only
  Scenario: Search for products
    Given I am on the Automation Exercise home page
    When I navigate to /products
    And I enter "Blue Top" in the "Search Product" field
    And I click the product search button
    Then "SEARCHED PRODUCTS" should be visible
    And every visible result should match the search term

  @automation-exercise:18 @read-only
  Scenario: Browse products by category and subcategory
    Given I am on the Automation Exercise home page
    Then the product category navigation should be visible
    When I click the "Women" category and its first subcategory
    Then the selected category heading and matching products should be visible
    When I click the first "Men" subcategory
    Then the selected men's category heading and matching products should be visible

  @automation-exercise:19 @read-only
  Scenario: Browse products by brand
    Given I am on the Automation Exercise home page
    When I navigate to /products
    Then the brands navigation should be visible
    When I click the first brand
    Then the selected brand heading and matching products should be visible
    When I click a different brand
    Then the new brand heading and matching products should be visible

  @automation-exercise:21 @external-write
  Scenario: Publish a product review
    Given I am on the Automation Exercise home page
    When I navigate to /products
    And I view the first product
    Then "WRITE YOUR REVIEW" should be visible
    When I submit a review with a disposable name and email address
    Then "Thank you for your review." should be visible
