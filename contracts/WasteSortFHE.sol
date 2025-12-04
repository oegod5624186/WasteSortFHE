// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract WasteSortFHE is SepoliaConfig {
    struct WasteImage {
        euint32 encryptedImageData;
        euint32 encryptedLocation;
        uint256 timestamp;
    }

    struct ClassificationResult {
        euint32 encryptedCategory;
        euint32 encryptedConfidence;
        bool isSorted;
    }

    struct CategoryStats {
        euint32 encryptedCount;
        euint32 encryptedWeight;
    }

    uint256 public imageCount;
    uint256 public categoryCount;
    mapping(uint256 => WasteImage) public wasteImages;
    mapping(uint256 => ClassificationResult) public classificationResults;
    mapping(uint32 => CategoryStats) public categoryStatistics;
    mapping(uint256 => uint256) private requestToImageId;
    mapping(uint256 => uint256) private requestToCategoryId;
    
    event ImageReceived(uint256 indexed imageId);
    event ClassificationStarted(uint256 indexed imageId);
    event SortingCompleted(uint256 indexed imageId);
    event CategoryAdded(uint32 indexed categoryId);

    function addWasteCategory(uint32 categoryId) public {
        require(categoryStatistics[categoryId].encryptedCount == FHE.asEuint32(0), "Category exists");
        categoryStatistics[categoryId] = CategoryStats({
            encryptedCount: FHE.asEuint32(0),
            encryptedWeight: FHE.asEuint32(0)
        });
        categoryCount++;
        emit CategoryAdded(categoryId);
    }

    function submitWasteImage(
        euint32 encryptedImageData,
        euint32 encryptedLocation
    ) public {
        imageCount++;
        wasteImages[imageCount] = WasteImage({
            encryptedImageData: encryptedImageData,
            encryptedLocation: encryptedLocation,
            timestamp: block.timestamp
        });
        emit ImageReceived(imageCount);
    }

    function classifyWaste(uint256 imageId) public {
        require(imageId <= imageCount, "Invalid image ID");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(wasteImages[imageId].encryptedImageData);
        ciphertexts[1] = FHE.toBytes32(wasteImages[imageId].encryptedLocation);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processClassification.selector);
        requestToImageId[reqId] = imageId;
        
        emit ClassificationStarted(imageId);
    }

    function processClassification(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 imageId = requestToImageId[requestId];
        require(imageId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory imageData = abi.decode(cleartexts, (uint32[]));
        uint32 pixelData = imageData[0];
        uint32 location = imageData[1];

        // Simplified classification (would use actual ML model)
        uint32 categoryId = determineCategory(pixelData);
        uint32 confidence = calculateConfidence(pixelData, categoryId);

        classificationResults[imageId] = ClassificationResult({
            encryptedCategory: FHE.asEuint32(categoryId),
            encryptedConfidence: FHE.asEuint32(confidence),
            isSorted: false
        });

        // Update category stats
        categoryStatistics[categoryId].encryptedCount = FHE.add(
            categoryStatistics[categoryId].encryptedCount,
            FHE.asEuint32(1)
        );
    }

    function sortWaste(uint256 imageId) public {
        ClassificationResult storage result = classificationResults[imageId];
        require(!result.isSorted, "Already sorted");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(result.encryptedCategory);
        ciphertexts[1] = FHE.toBytes32(result.encryptedConfidence);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.executeSorting.selector);
        requestToImageId[reqId] = imageId;
    }

    function executeSorting(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 imageId = requestToImageId[requestId];
        require(imageId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory sortData = abi.decode(cleartexts, (uint32[]));
        uint32 category = sortData[0];
        uint32 confidence = sortData[1];

        // Execute physical sorting (simulated)
        classificationResults[imageId].isSorted = true;
        emit SortingCompleted(imageId);
    }

    function requestCategoryStats(uint32 categoryId) public {
        require(categoryStatistics[categoryId].encryptedCount != FHE.asEuint32(0), "Invalid category");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(categoryStatistics[categoryId].encryptedCount);
        ciphertexts[1] = FHE.toBytes32(categoryStatistics[categoryId].encryptedWeight);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptCategoryStats.selector);
        requestToCategoryId[reqId] = categoryId;
    }

    function decryptCategoryStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint32 categoryId = uint32(requestToCategoryId[requestId]);
        require(categoryId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory stats = abi.decode(cleartexts, (uint32[]));
        // Process decrypted stats as needed
    }

    function determineCategory(uint32 pixelData) private pure returns (uint32) {
        // Simplified categorization logic
        return pixelData % 5 + 1; // 5 waste categories
    }

    function calculateConfidence(uint32 pixelData, uint32 category) private pure returns (uint32) {
        // Simplified confidence calculation
        return (pixelData % 71) + 30; // Random confidence between 30-100
    }

    function getImageStatus(uint256 imageId) public view returns (bool) {
        return classificationResults[imageId].isSorted;
    }

    function getCategoryCount(uint32 categoryId) public view returns (euint32) {
        return categoryStatistics[categoryId].encryptedCount;
    }
}