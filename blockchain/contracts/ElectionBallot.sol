// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ElectionBallot {
    address public commissionAdmin;
    bool public ballotOpen;
    uint256 public totalParties;

    struct Party {
        uint256 partyNumber;
        string name;
        string symbolLabel;
        uint256 voteCount;
    }

    struct VoterRecord {
        bool isEligible;
        bool hasVoted;
        uint256 votedPartyNumber;
    }

    mapping(uint256 => Party) private parties;
    mapping(address => VoterRecord) public voters;
    uint256[] private partyNumbers;

    event PartyRegistered(uint256 indexed partyNumber, string name, string symbolLabel);
    event VoterEligibleSet(address indexed voterAddress, bool eligible);
    event BallotStateChanged(bool isOpen);
    event BallotCast(
        address indexed voterAddress,
        uint256 indexed partyNumber,
        uint256 blockNumber,
        uint256 timestamp
    );

    modifier onlyAdmin() {
        require(msg.sender == commissionAdmin, "Only Election Commission admin allowed");
        _;
    }

    modifier whenOpen() {
        require(ballotOpen, "Ballot is currently closed");
        _;
    }

    constructor() {
        commissionAdmin = msg.sender;
        ballotOpen = false;
    }

    function registerParty(string calldata _name, string calldata _symbolLabel) external onlyAdmin {
        require(!ballotOpen, "Cannot register parties while ballot is open");
        require(bytes(_name).length > 0, "Party name is required");

        totalParties++;
        uint256 assignedNumber = totalParties;

        parties[assignedNumber] = Party({
            partyNumber: assignedNumber,
            name: _name,
            symbolLabel: _symbolLabel,
            voteCount: 0
        });
        partyNumbers.push(assignedNumber);

        emit PartyRegistered(assignedNumber, _name, _symbolLabel);
    }

    function setVoterEligible(address _voter, bool _eligible) external onlyAdmin {
        require(_voter != address(0), "Invalid address");
        voters[_voter].isEligible = _eligible;
        emit VoterEligibleSet(_voter, _eligible);
    }

    function setBallotOpen(bool _open) external onlyAdmin {
        ballotOpen = _open;
        emit BallotStateChanged(_open);
    }

    function castVoteByPartyNumber(uint256 _partyNumber) external whenOpen {
        VoterRecord storage voter = voters[msg.sender];
        require(voter.isEligible, "Voter is not eligible on the blockchain registry");
        require(!voter.hasVoted, "Duplicate vote blocked: ballot already cast");
        require(_partyNumber >= 1 && _partyNumber <= totalParties, "Invalid party number");

        voter.hasVoted = true;
        voter.votedPartyNumber = _partyNumber;
        parties[_partyNumber].voteCount += 1;

        emit BallotCast(msg.sender, _partyNumber, block.number, block.timestamp);
    }

    function getAllParties() external view returns (Party[] memory) {
        Party[] memory list = new Party[](partyNumbers.length);
        for (uint256 i = 0; i < partyNumbers.length; i++) {
            list[i] = parties[partyNumbers[i]];
        }
        return list;
    }
}