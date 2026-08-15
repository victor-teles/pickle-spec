Feature: Search

  @ignore
  Scenario: Visit main page
    Given I navigate to main page
    When I input "Brazil" on search input and press enter
    Then I should see a search results with Brazil related sites
