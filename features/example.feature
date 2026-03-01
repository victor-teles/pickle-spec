Feature: Example Search

  Scenario: Visit a website
    Given I navigate to "https://example.com"
    Then I should see "Example Domain"

  @smoke
  Scenario: Check page title
    Given I am on "https://example.com"
    When I look at the page
    Then I should see a heading with text "Example Domain"
