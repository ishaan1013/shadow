#!/bin/bash

# Quick debug script to see what's wrong with VM deployment

echo "=== VM DEPLOYMENT DEBUG ==="

echo "1. Current jobs:"
kubectl get jobs -n shadow-agents -l component=vm-deployer

echo -e "\n2. Current pods:" 
kubectl get pods -n shadow-agents -l component=vm-deployer

echo -e "\n3. Pod details:"
kubectl describe pods -n shadow-agents -l component=vm-deployer

echo -e "\n4. Recent events:"
kubectl get events -n shadow-agents --sort-by='.lastTimestamp' | tail -15

echo -e "\n5. Pod logs:"
kubectl logs -n shadow-agents -l component=vm-deployer --tail=50

echo -e "\n6. Firecracker nodes:"
kubectl get nodes -l firecracker=true

echo -e "\n7. Secret exists?"
kubectl get secret ghcr-secret -n shadow-agents