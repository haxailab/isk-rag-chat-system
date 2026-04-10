#!/bin/bash

# Create Lambda Layer for document generation libraries
echo "Creating Lambda Layer for document generation..."

# Create layer directory structure
mkdir -p lambda-layers/document-generation/python

# Install dependencies
cd lambda-layers/document-generation
pip install -r ../../lambda/document-generator/requirements.txt -t python/

# Create zip file for layer
zip -r document-generation-layer.zip python/

echo "Lambda layer created: lambda-layers/document-generation/document-generation-layer.zip"