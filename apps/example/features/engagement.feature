@pickle:state:active
Feature: Customer engagement

  @automation-exercise:6 @external-write @requires-upload
  Scenario: Send a contact request
    Given I am on the Automation Exercise home page
    When I navigate to /contact_us
    Then "GET IN TOUCH" should be visible
    When I enter disposable contact details and a message
    And I attach the configured harmless upload file
    And I submit and confirm the contact form
    Then the contact success message should be visible
    When I return home
    Then I should be on the Automation Exercise home page

  @automation-exercise:10 @external-write
  Scenario: Subscribe from the home page
    Given I am on the Automation Exercise home page
    When I scroll to "SUBSCRIPTION"
    And I subscribe with a unique disposable email address
    Then "You have been successfully subscribed!" should be visible

  @automation-exercise:11 @external-write
  Scenario: Subscribe from the cart page
    Given I am on the Automation Exercise home page
    When I navigate to /view_cart
    And I scroll to "SUBSCRIPTION"
    And I subscribe with a unique disposable email address
    Then "You have been successfully subscribed!" should be visible

  @automation-exercise:25 @read-only
  Scenario: Scroll to the top with the arrow control
    Given I am on the Automation Exercise home page
    When I scroll to the bottom of the page
    Then "SUBSCRIPTION" should be visible
    When I use the scroll-up arrow
    Then "Full-Fledged practice website for Automation Engineers" should be visible

  @automation-exercise:26 @read-only
  Scenario: Scroll to the top without the arrow control
    Given I am on the Automation Exercise home page
    When I scroll to the bottom of the page
    Then "SUBSCRIPTION" should be visible
    When I scroll to the top of the page without using the arrow control
    Then "Full-Fledged practice website for Automation Engineers" should be visible
